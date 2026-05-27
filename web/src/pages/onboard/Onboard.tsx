// Schema-driven onboarding wizard mirroring `zeroclaw onboard` (#6175).
//
// Layout:
//   ┌─ Sidebar ────┐ ┌─ Breadcrumb (Onboard › Section › ?picked) ─┐
//   │ Workspace ✓  │ │ Help text                                   │
//   │ Providers ▶  │ │                                             │
//   │ Channels     │ │  Either: <SectionPicker> (catalog list)     │
//   │ Memory       │ │     Or:  <FieldForm>     (the picked item)  │
//   │ Hardware     │ │                                             │
//   │ Tunnel       │ │  [ Back ]              [ Done — next ▶ ]    │
//   └──────────────┘ └─────────────────────────────────────────────┘
//
// Section list comes from /api/onboard/sections (single source of truth).
// Picker items come from /api/onboard/sections/<key>. Picking POSTs
// /api/onboard/sections/<key>/items/<picked> which instantiates the entry
// and returns the dotted prefix to render fields under. FieldForm reads
// /api/config/list?prefix=<that> and PATCHes on save. Provider model
// fields auto-fetch /api/onboard/catalog/models for the datalist.

import { forwardRef, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, Check, ChevronRight } from 'lucide-react';
import {
  ApiError,
  getMapKeys,
  getOnboardStatus,
  getProp,
  getSections,
  patchConfig,
  reloadDaemon,
  selectSectionItem,
  type PickerItem,
  type SectionInfo,
} from '../../lib/api';
import { t } from '../../lib/i18n';
import { isLocalModelProviderName } from '../../lib/modelProviders';
import FieldForm, { type FieldFormHandle } from '../../components/onboard/FieldForm';
import ChannelSetupGuide from '../../components/onboard/ChannelSetupGuide';
import SectionPicker from '../../components/onboard/SectionPicker';

// Personality pulls in CodeMirror + markdown rendering (~270KB gzipped).
// Config's top-level nested field is exposed through the usual prop-path
// kebab form even though the persisted TOML table is `[onboard_state]`.
const COMPLETED_SECTIONS_PATH = 'onboard-state.completed-sections';

// Section list + its canonical order both come from the gateway,
// which derives them from `zeroclaw_config::sections::ONBOARDING_SECTIONS`
// (single source of truth, also used by the CLI runtime). The frontend
// filters by `is_onboarding`. First-run Browser onboarding presents the
// small happy path in dependency order. Agent-first setup needs a more
// explicit "configure this agent" flow, so keep agent creation at the end
// for now.
const FIRST_RUN_SECTION_ORDER = [
  'providers.models',
  'risk-profiles',
  'runtime-profiles',
  'storage',
  'memory',
  'agents',
] as const;
const FIRST_RUN_SECTION_KEYS = new Set<string>(FIRST_RUN_SECTION_ORDER);

export default function Onboard() {
  const navigate = useNavigate();
  const [sections, setSections] = useState<SectionInfo[]>([]);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [picked, setPicked] = useState<{ item: PickerItem; fieldsPrefix: string } | null>(null);
  // When a provider/channel type is selected, show alias list inline before opening form.
  const [pickedType, setPickedType] = useState<{ item: PickerItem; sectionKey: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [finishing, setFinishing] = useState(false);
  const [advancing, setAdvancing] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [canFinish, setCanFinish] = useState(false);
  const [finishIssues, setFinishIssues] = useState<string[] | null>(null);
  const [issueTitle, setIssueTitle] = useState(t('onboard.complete_step_before_continue'));
  const [applyIssue, setApplyIssue] = useState<string | null>(null);
  const [editingProfile, setEditingProfile] = useState(false);
  const [selectedAgentAlias, setSelectedAgentAlias] = useState<string | null>(null);
  // Ref into the currently-rendered FieldForm (direct-form sections like
  // Workspace, or the post-pick form for Providers/Channels/Tunnel) so
  // breadcrumb Next/Finish can flush unsaved edits before advancing.
  const formRef = useRef<FieldFormHandle | null>(null);

  const refreshReadiness = useCallback(async () => {
    try {
      const resp = await getSections();
      const onboardingSections = resp.sections.filter((s) => s.is_onboarding);
      setSections(onboardingSections);
      const status = await getOnboardStatus();
      const readyToFinish = !status.needs_onboarding && firstRunRequiredSectionsReady(onboardingSections);
      setCanFinish(readyToFinish);
      if (readyToFinish) setFinishIssues(null);
      const agents = await getMapKeys('agents').catch(() => null);
      const onlyAgent = agents?.keys.length === 1 ? agents.keys[0] : null;
      if (onlyAgent) {
        setSelectedAgentAlias((current) => current ?? onlyAgent);
      }
    } catch {
      // Keep the prior readiness state on transient auth/network errors.
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getSections()
      .then((resp) => {
        if (cancelled) return;
        // Filter to wizard sections; trust gateway-provided order.
        const ordered = resp.sections.filter((s) => s.is_onboarding);
        setSections(ordered);
        getMapKeys('agents')
          .then((agents) => {
            const onlyAgent = agents.keys.length === 1 ? agents.keys[0] : null;
            if (!cancelled && onlyAgent) {
              setSelectedAgentAlias((current) => current ?? onlyAgent);
            }
          })
          .catch(() => {});
        const firstRun = orderFirstRunSections(ordered.filter((s) => FIRST_RUN_SECTION_KEYS.has(s.key)));
        // Open the first not-yet-ready first-run section. A section can be
        // marked completed by navigation while still missing required setup.
        const next = firstRun.find((s) => !s.ready);
        setActiveKey(next?.key ?? firstRun[0]?.key ?? ordered[0]?.key ?? null);
        void refreshReadiness();
      })
      .catch((e) => {
        if (cancelled) return;
        if (e instanceof ApiError) {
          setError(`[${e.envelope.code}] ${e.envelope.message}`);
        } else {
          setError(`Couldn't load sections: ${e instanceof Error ? e.message : String(e)}`);
        }
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [refreshReadiness]);

  const activeSection = useMemo(
    () => sectionByKey(sections, activeKey, selectedAgentAlias, canFinish),
    [sections, activeKey, selectedAgentAlias, canFinish],
  );
  const firstRunSections = useMemo(
    () => firstRunSectionsFor(sections, selectedAgentAlias, canFinish),
    [canFinish, sections, selectedAgentAlias],
  );
  const advancedSections = useMemo(
    () => sections.filter((s) => !FIRST_RUN_SECTION_KEYS.has(s.key)),
    [sections],
  );
  const sidebarSections = useMemo(
    () =>
      showAdvanced
        ? [...firstRunSections, ...advancedSections]
        : firstRunSections.length > 0
          ? firstRunSections
          : sections,
    [advancedSections, firstRunSections, sections, showAdvanced],
  );
  const navigationSections = useMemo(
    () => {
      if (!activeSection) return sidebarSections;
      if (FIRST_RUN_SECTION_KEYS.has(activeSection.key) && firstRunSections.length > 0) {
        return firstRunSections;
      }
      if (showAdvanced && advancedSections.length > 0) return advancedSections;
      return firstRunSections.length > 0 ? firstRunSections : sections;
    },
    [activeSection, advancedSections, firstRunSections, sections, showAdvanced, sidebarSections],
  );

  const goToSection = (key: string) => {
    setActiveKey(key);
    setPicked(null);
    setPickedType(null);
    setEditingProfile(false);
    setFinishIssues(null);
    setApplyIssue(null);
  };

  const bindSelectionToSelectedAgent = useCallback(async (sectionKey: string, fieldsPrefix: string) => {
    if (!selectedAgentAlias) return;
    const binding = agentBindingForSelection(sectionKey, fieldsPrefix);
    if (!binding) return;

    const path = `agents.${selectedAgentAlias}.${binding.field}`;
    try {
      const current = await getProp(path).catch(() => null);
      const currentValue = current?.value;
      const currentText = typeof currentValue === 'string' ? currentValue.trim() : '';
      if (currentText && currentText !== '<unset>') return;
      await patchConfig([{ op: 'replace', path, value: binding.value }]);
    } catch (e) {
      // Keep selection usable even if auto-binding fails; Finish readiness will
      // still show the missing agent assignment.
      // eslint-disable-next-line no-console
      console.warn('Failed to bind onboarding selection to selected agent:', e);
    }
  }, [selectedAgentAlias]);

  const bindMemoryToSelectedAgent = useCallback(async (backend: string) => {
    if (!selectedAgentAlias) return;
    try {
      await patchConfig([
        { op: 'replace', path: `agents.${selectedAgentAlias}.memory.backend`, value: backend },
      ]);
    } catch (e) {
      // The global memory choice is still saved; the final assignment check
      // keeps the agent visible if the per-agent write fails.
      // eslint-disable-next-line no-console
      console.warn('Failed to bind memory backend to selected agent:', e);
    }
  }, [selectedAgentAlias]);

  const openWithAlias = async (item: PickerItem, sectionKey: string, alias: string) => {
    setFinishIssues(null);
    setApplyIssue(null);
    const resp = await selectSectionItem(sectionKey, item.key, alias);
    setPickedType(null);
    setPicked({ item, fieldsPrefix: resp.fields_prefix });
    setEditingProfile(false);
    await bindSelectionToSelectedAgent(sectionKey, resp.fields_prefix);
    await refreshReadiness();
  };

  const handlePick = async (item: PickerItem) => {
    if (!activeSection) return;
    setFinishIssues(null);
    setApplyIssue(null);
    // Two-tier `<type>.<alias>` sections (typed-family providers and
    // channels) flow into the type→alias picker; everything else picks
    // its item directly. Server-emitted shape drives the branch — no
    // hardcoded section keys.
    if (activeSection.shape === 'typed_family_map') {
      setPickedType({ item, sectionKey: activeSection.key });
      return;
    }
    try {
      const resp = await selectSectionItem(activeSection.key, item.key);
      setPicked({ item, fieldsPrefix: resp.fields_prefix });
      if (activeSection.key === 'memory') {
        await bindMemoryToSelectedAgent(item.key);
      }
      await refreshReadiness();
    } catch (e) {
      if (e instanceof ApiError) {
        setError(`Couldn't open ${item.label}: [${e.envelope.code}] ${e.envelope.message}`);
      } else {
        setError(`Couldn't open ${item.label}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  };

  // Save any pending form edits first; refuse to advance if the save
  // failed (validator rejected something), so the user can fix it.
  const flushActiveForm = async (): Promise<boolean> => {
    if (!formRef.current) return true;
    try {
      return await formRef.current.flushSave();
    } catch {
      return false;
    }
  };

  const blockAdvance = (issues: string[]) => {
    setIssueTitle(t('onboard.complete_step_before_continue'));
    setFinishIssues(issues);
    return false;
  };

  const validateAdvance = async (): Promise<boolean> => {
    if (!activeSection) return false;
    setFinishIssues(null);

    if (activeSection.key === 'agents' && !selectedAgentAlias) {
      return blockAdvance([t('onboard.choose_agent_setup')]);
    }

    if (activeSection.key === 'providers.models') {
      if (!picked && !activeSection.ready) {
        return blockAdvance([t('onboard.choose_model_provider')]);
      }
      if (picked) {
        const providerIssues = await modelProviderStepIssues(picked);
        if (providerIssues.length > 0) return blockAdvance(providerIssues);
      }
    }

    if (activeSection.key === 'storage' && !picked && !activeSection.ready) {
      return blockAdvance([t('onboard.choose_storage_backend')]);
    }

    if (activeSection.key === 'memory' && !picked && !activeSection.ready) {
      return blockAdvance([t('onboard.choose_memory_backend')]);
    }

    return true;
  };

  const advanceSection = async () => {
    if (!activeSection) return;
    setAdvancing(true);
    try {
      if (!(await flushActiveForm())) return;
      if (!(await validateAdvance())) return;
      // Mark current section completed server-side, then jump to the next.
      try {
        const current = await getProp(COMPLETED_SECTIONS_PATH).catch(() => ({ value: '[]' }));
        const existing = parseCompleted(current.value);
        const completedKey = completionKeyFor(activeSection.key);
        if (!existing.includes(completedKey)) existing.push(completedKey);
        await patchConfig([
          { op: 'replace', path: COMPLETED_SECTIONS_PATH, value: existing },
        ]);
        setSections((prev) =>
          prev.map((s) =>
            s.key === completedKey ? { ...s, completed: true } : s,
          ),
        );
      } catch (e) {
        // Don't fail the flow on a marker failure — log and proceed.
        // eslint-disable-next-line no-console
        console.warn('Failed to persist completion marker:', e);
      }
      await refreshReadiness();
      const idx = navigationSections.findIndex((s) => s.key === activeSection.key);
      const next = navigationSections[idx + 1];
      if (next) {
        setActiveKey(next.key);
        setPicked(null);
        setPickedType(null);
        setEditingProfile(false);
      } else {
        setPicked(null);
        setPickedType(null);
        setEditingProfile(false);
      }
    } finally {
      setAdvancing(false);
    }
  };

  // Finish: save the current form (if any), mark the active section
  // completed, run a backend readiness check, then apply the finished config.
  // If the agent cannot reply yet, stay in onboarding and show exact missing
  // pieces instead of returning to the dashboard with an opaque chat error.
  const finishOnboarding = async () => {
    if (!activeSection) return;
    setFinishing(true);
    setFinishIssues(null);
    setApplyIssue(null);
    try {
      if (!(await flushActiveForm())) return;
      try {
        const current = await getProp(COMPLETED_SECTIONS_PATH).catch(() => ({ value: '[]' }));
        const existing = parseCompleted(current.value);
        const completedKey = completionKeyFor(activeSection.key);
        if (!existing.includes(completedKey)) existing.push(completedKey);
        await patchConfig([
          { op: 'replace', path: COMPLETED_SECTIONS_PATH, value: existing },
        ]);
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('Failed to persist completion marker on finish:', e);
      }
      const status = await getOnboardStatus();
      const resp = await getSections();
      const onboardingSections = resp.sections.filter((s) => s.is_onboarding);
      setSections(onboardingSections);
      const wizardIssues = firstRunReadinessIssues(onboardingSections);
      const readyToFinish = !status.needs_onboarding && wizardIssues.length === 0;
      setCanFinish(readyToFinish);
      if (!readyToFinish) {
        setIssueTitle(t('onboard.finish_needs_runnable_agent'));
        setFinishIssues(
          status.missing.length > 0 || wizardIssues.length > 0
            ? [...status.missing, ...wizardIssues]
            : [t('onboard.complete_required_steps')],
        );
        return;
      }
      try {
        await reloadDaemon();
        await new Promise((r) => setTimeout(r, 400));
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('Daemon reload failed after onboarding; user can retry from /config:', e);
        setApplyIssue(
          t('onboard.reload_failed_help'),
        );
        return;
      }
      navigate('/');
    } finally {
      setFinishing(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div
          className="h-8 w-8 border-2 rounded-full animate-spin"
          style={{ borderColor: 'var(--pc-border)', borderTopColor: 'var(--pc-accent)' }}
        />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <div
          className="rounded-xl border p-4 text-sm"
          style={{
            background: 'rgba(239, 68, 68, 0.08)',
            borderColor: 'rgba(239, 68, 68, 0.2)',
            color: '#f87171',
          }}
        >
          {error}
        </div>
      </div>
    );
  }

  const activeBreadcrumbDetail = activeSection
    ? breadcrumbDetail(activeSection, picked, pickedType)
    : null;

  return (
    <div className="flex h-full overflow-hidden">
      {/* Sidebar */}
      <aside
        className="w-56 flex-shrink-0 border-r overflow-y-auto"
        style={{
          borderColor: 'var(--pc-border)',
          background: 'var(--pc-bg-surface)',
        }}
      >
        <div
          className="px-4 py-3 text-xs font-semibold uppercase tracking-wider"
          style={{ color: 'var(--pc-text-secondary)' }}
        >
          {t('onboard.sections')}
        </div>
        <nav className="flex flex-col">
          {sidebarSections.map((s) => (
            <button
              key={s.key}
              type="button"
              onClick={() => goToSection(s.key)}
              className="flex items-center justify-between gap-2 px-4 py-2.5 text-sm text-left transition-colors"
              style={{
                background:
                  s.key === activeKey ? 'var(--pc-accent-glow)' : 'transparent',
                color:
                  s.key === activeKey
                    ? 'var(--pc-accent)'
                    : 'var(--pc-text-primary)',
                fontWeight: s.key === activeKey ? 600 : 400,
                borderLeft:
                  s.key === activeKey
                    ? '2px solid var(--pc-accent)'
                    : '2px solid transparent',
              }}
            >
              <span className="flex items-center gap-2">
                {s.ready && (
                  <Check
                    className="h-3.5 w-3.5"
                    style={{ color: 'var(--color-status-success)' }}
                  />
                )}
                {sidebarLabel(s, selectedAgentAlias)}
              </span>
              {s.key === activeKey && <ChevronRight className="h-3.5 w-3.5" />}
            </button>
          ))}
          {advancedSections.length > 0 && (
            <button
              type="button"
              onClick={() => setShowAdvanced((show) => !show)}
              className="px-4 py-2.5 text-sm text-left transition-colors"
              style={{ color: 'var(--pc-text-secondary)' }}
            >
              {showAdvanced ? t('onboard.hide_advanced') : t('onboard.show_advanced')}
            </button>
          )}
        </nav>
      </aside>

      {/* Main pane */}
      <main className="flex-1 overflow-y-auto p-6">
        {activeSection && (
          <div className="flex flex-col gap-4 max-w-3xl">
            {/* Breadcrumb + always-available Next/Done. The form's own Save
                bar advances the flow on save, but users editing nothing
                (Hardware defaults, e.g.) still need a way out — this gives
                them one regardless of dirty state. */}
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div
                className="text-sm flex items-center gap-1.5 flex-wrap"
                style={{ color: 'var(--pc-text-muted)' }}
              >
                <span style={{ color: 'var(--pc-text-secondary)' }}>{t('onboard.root')}</span>
                <ChevronRight className="h-3 w-3" />
                <span
                  style={{
                    color: activeBreadcrumbDetail ? 'var(--pc-text-secondary)' : 'var(--pc-accent)',
                    cursor: activeBreadcrumbDetail ? 'pointer' : 'default',
                    fontWeight: activeBreadcrumbDetail ? 400 : 600,
                  }}
                  onClick={() => { setPicked(null); setPickedType(null); setEditingProfile(false); }}
                >
                  {activeSection.label}
                </span>
                {activeBreadcrumbDetail && (
                  <>
                    <ChevronRight className="h-3 w-3" />
                    <span style={{ color: 'var(--pc-accent)', fontWeight: 600 }}>
                      {activeBreadcrumbDetail}
                    </span>
                  </>
                )}
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                {canFinish && (
                  <button
                    type="button"
                    disabled={finishing || advancing}
                    onClick={() => void finishOnboarding()}
                    className="btn-secondary inline-flex items-center gap-1.5 text-sm px-3 py-2"
                    title={t('onboard.apply_setup_title')}
                  >
                    {finishing ? t('onboard.finishing') : t('onboard.finish')}
                  </button>
                )}
                {!isLastSection(navigationSections, activeSection.key) && (
                  <button
                    type="button"
                    disabled={finishing || advancing}
                    onClick={() => void advanceSection()}
                    className="btn-electric inline-flex items-center gap-1.5 text-sm px-4 py-2"
                    title={t('onboard.save_next_title')}
                  >
                    {advancing ? t('onboard.saving') : `${t('onboard.next')} ▶`}
                  </button>
                )}
              </div>
            </div>
            {finishIssues && (
              <div
                className="rounded-xl border p-4 text-sm flex items-start gap-3"
                style={{
                  background: 'rgba(239, 68, 68, 0.08)',
                  borderColor: 'rgba(239, 68, 68, 0.2)',
                  color: '#fca5a5',
                }}
              >
                <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium mb-2" style={{ color: 'var(--pc-text-primary)' }}>
                    {issueTitle}
                  </p>
                  <ul className="list-disc pl-5 space-y-1">
                    {finishIssues.map((issue) => (
                      <li key={issue}>{issue}</li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
            {applyIssue && (
              <div
                className="rounded-xl border p-4 text-sm flex items-start gap-3"
                style={{
                  background: 'rgba(245, 180, 0, 0.08)',
                  borderColor: 'rgba(245, 180, 0, 0.25)',
                  color: '#fbbf24',
                }}
              >
                <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium mb-1" style={{ color: 'var(--pc-text-primary)' }}>
                    {t('onboard.setup_saved_not_applied')}
                  </p>
                  <p>{applyIssue}</p>
                </div>
              </div>
            )}

            {/* Picker / form dispatch — driven by the server-emitted
                `shape` flag so /onboard and /config render identically
                for the same section. */}
            {activeSection.key === 'agents' && selectedAgentAlias ? (
              <>
                <AgentFirstRunForm
                  ref={formRef}
                  prefix={`agents.${selectedAgentAlias}`}
                  title={`Agent: ${selectedAgentAlias}`}
                  onSaved={() => {
                    void refreshReadiness();
                  }}
                />
                <FirstRunCompleteActions
                  canFinish={canFinish}
                  finishing={finishing}
                  onFinish={() => void finishOnboarding()}
                  onAdvanced={() => {
                    setShowAdvanced(true);
                    if (advancedSections[0]) goToSection(advancedSections[0].key);
                  }}
                />
              </>
            ) : !activeSection.has_picker ? (
              <>
                <OnboardingFormGuide sectionKey={activeSection.key} prefix={activeSection.key} />
                <FieldForm
                  ref={formRef}
                  prefix={activeSection.key}
                  title={activeSection.label}
                  onSaved={() => void refreshReadiness()}
                />
              </>
            ) : picked && isDefaultProfileSection(activeSection.key) && !editingProfile ? (
              <DefaultProfileSummary
                sectionKey={activeSection.key}
                prefix={picked.fieldsPrefix}
                onEdit={() => setEditingProfile(true)}
                onContinue={() => void advanceSection()}
                onPresetApplied={() => void refreshReadiness()}
              />
            ) : picked && activeSection.key === 'memory' && !editingProfile ? (
              <MemoryBackendSummary
                item={picked.item}
                onEdit={() => setEditingProfile(true)}
                onContinue={() => void advanceSection()}
              />
            ) : picked ? (
              <>
                <OnboardingFormGuide sectionKey={activeSection.key} prefix={picked.fieldsPrefix} />
                <FieldForm
                  ref={formRef}
                  prefix={picked.fieldsPrefix}
                  title={formTitleFor(activeSection.key, picked)}
                  onSaved={() => {
                    setPicked(null);
                    void refreshReadiness();
                  }}
                />
              </>
            ) : pickedType ? (
              <OnboardAliasListView
                sectionKey={pickedType.sectionKey}
                typeKey={pickedType.item.key}
                typeLabel={pickedType.item.label}
                onSelectAlias={(alias) => openWithAlias(pickedType.item, pickedType.sectionKey, alias)}
              />
            ) : activeSection.shape === 'one_tier_alias_map' ? (
              // Flat alias map (agents). Same UX as /config/<section>:
              // alias list with Create. Picking an alias opens its form.
              <OnboardOneTierAliasView
                sectionKey={activeSection.key}
                onSelectAlias={async (alias) => {
                  try {
                    const resp = await selectSectionItem(activeSection.key, alias);
                    if (activeSection.key === 'agents') {
                      setSelectedAgentAlias(alias);
                    }
                    setPicked({
                      item: { key: alias, label: alias },
                      fieldsPrefix: resp.fields_prefix,
                    });
                    setEditingProfile(false);
                    await bindSelectionToSelectedAgent(activeSection.key, resp.fields_prefix);
                    await refreshReadiness();
                  } catch (e) {
                    setError(
                      e instanceof ApiError
                        ? `[${e.envelope.code}] ${e.envelope.message}`
                        : `Couldn't open ${alias}: ${e instanceof Error ? e.message : String(e)}`,
                    );
                  }
                }}
              />
            ) : (
              <SectionPicker
                sectionKey={activeSection.key}
                help={activeSection.key === 'storage' ? '' : activeSection.help}
                onPick={(item) => void handlePick(item)}
                onSkip={() => void advanceSection()}
              />
            )}
          </div>
        )}
      </main>

    </div>
  );
}

function breadcrumbDetail(
  section: SectionInfo,
  picked: { item: PickerItem; fieldsPrefix: string } | null,
  pickedType: { item: PickerItem; sectionKey: string } | null,
): string | null {
  if (picked) {
    const alias = picked.fieldsPrefix.split('.').slice(-1)[0] ?? picked.item.label;
    return `${entityLabel(section.key, picked.item.label)}: ${alias}`;
  }
  if (pickedType) return `${pickedType.item.label} aliases`;
  return null;
}

function firstRunRequiredSectionsReady(sections: SectionInfo[]): boolean {
  return firstRunReadinessIssues(sections).length === 0;
}

function firstRunReadinessIssues(sections: SectionInfo[]): string[] {
  const labels = new Map(sections.map((section) => [section.key, section.label]));
  const byKey = new Map(sections.map((section) => [section.key, section]));
  return FIRST_RUN_SECTION_ORDER
    .filter((key) => !byKey.get(key)?.ready)
    .map((key) => `${labels.get(key) ?? key} is not complete yet.`);
}

function sectionByKey(
  sections: SectionInfo[],
  key: string | null,
  _selectedAgentAlias: string | null,
  _canFinish: boolean,
): SectionInfo | null {
  if (!key) return null;
  return sections.find((s) => s.key === key) ?? null;
}

function firstRunSectionsFor(
  sections: SectionInfo[],
  selectedAgentAlias: string | null,
  canFinish: boolean,
): SectionInfo[] {
  const real = sections.filter((s) => FIRST_RUN_SECTION_KEYS.has(s.key));
  return orderFirstRunSections(real).map((section) =>
    section.key === 'agents' && selectedAgentAlias
      ? { ...section, completed: canFinish, ready: canFinish }
      : section,
  );
}

function completionKeyFor(sectionKey: string): string {
  return sectionKey;
}

function sidebarLabel(section: SectionInfo, selectedAgentAlias: string | null): string {
  if (section.key === 'agents') return selectedAgentAlias ? `Agent: ${selectedAgentAlias}` : 'Agent';
  return section.label;
}

function orderFirstRunSections(sections: SectionInfo[]): SectionInfo[] {
  const order = new Map<string, number>(FIRST_RUN_SECTION_ORDER.map((key, index) => [key, index]));
  return [...sections].sort((a, b) => {
    const aRank = order.get(a.key) ?? Number.MAX_SAFE_INTEGER;
    const bRank = order.get(b.key) ?? Number.MAX_SAFE_INTEGER;
    return aRank - bRank;
  });
}

function agentBindingForSelection(
  sectionKey: string,
  fieldsPrefix: string,
): { field: string; value: string } | null {
  const parts = fieldsPrefix.split('.');
  if (sectionKey === 'providers.models' && parts[0] === 'providers' && parts[1] === 'models') {
    const providerType = parts[2];
    const providerAlias = parts[3];
    if (providerType && providerAlias) {
      return { field: 'model-provider', value: `${canonicalProviderRefSegment(providerType)}.${providerAlias}` };
    }
  }
  if (sectionKey === 'risk-profiles') {
    const alias = parts[1];
    return alias ? { field: 'risk-profile', value: alias } : null;
  }
  if (sectionKey === 'runtime-profiles') {
    const alias = parts[1];
    return alias ? { field: 'runtime-profile', value: alias } : null;
  }
  return null;
}

function providerRefForFieldsPrefix(fieldsPrefix: string): string | null {
  const parts = fieldsPrefix.split('.');
  if (parts[0] !== 'providers' || parts[1] !== 'models') return null;
  const providerType = parts[2];
  const providerAlias = parts[3];
  return providerType && providerAlias ? `${canonicalProviderRefSegment(providerType)}.${providerAlias}` : null;
}

async function modelProviderStepIssues(picked: { item: PickerItem; fieldsPrefix: string }): Promise<string[]> {
  const providerRef = providerRefForFieldsPrefix(picked.fieldsPrefix) ?? picked.item.label;
  const model = await getProp(`${picked.fieldsPrefix}.model`).catch(() => null);
  if (!hasTextValue(model?.value)) {
    return [`Choose a model for model provider \`${providerRef}\`.`];
  }

  if (isLocalPickerItem(picked.item)) return [];

  const apiKey = await getProp(`${picked.fieldsPrefix}.api-key`).catch(() => null);
  const openAiAuth = await getProp(`${picked.fieldsPrefix}.requires-openai-auth`).catch(() => null);
  if (apiKey?.populated || isTruthyValue(openAiAuth?.value)) return [];
  return [`Set credential/auth for model provider \`${providerRef}\`.`];
}

function hasTextValue(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0 && value.trim() !== '<unset>';
}

function isTruthyValue(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.trim().toLowerCase() === 'true';
  return false;
}

function isLocalPickerItem(item: PickerItem): boolean {
  return item.description?.toLowerCase().includes('local') ?? false;
}

function canonicalProviderRefSegment(providerType: string): string {
  return providerType.replace(/-/g, '_');
}

function formTitleFor(sectionKey: string, picked: { item: PickerItem; fieldsPrefix: string }): string {
  const alias = picked.fieldsPrefix.split('.').slice(-1)[0] ?? picked.item.label;
  return `${entityLabel(sectionKey, picked.item.label)}: ${alias}`;
}

function entityLabel(sectionKey: string, itemLabel: string): string {
  switch (sectionKey) {
    case 'providers.models':
      return `${itemLabel} 提供商`;
    case 'providers.tts':
      return `${itemLabel} TTS 提供商`;
    case 'providers.transcription':
      return `${itemLabel} 转录提供商`;
    case 'risk-profiles':
      return '风险配置';
    case 'runtime-profiles':
      return '运行时配置';
    case 'storage':
      return `${capitalize(itemLabel)} 存储`;
    case 'agents':
      return '智能体';
    default:
      return itemLabel;
  }
}

function OnboardingFormGuide({ sectionKey, prefix }: { sectionKey: string; prefix: string }) {
  const guide = guideFor(sectionKey, prefix);
  if (!guide) return null;
  return (
    <div
      className="rounded-xl border p-4 text-sm"
      style={{
        background: 'var(--pc-bg-surface-subtle)',
        borderColor: 'var(--pc-border)',
        color: 'var(--pc-text-secondary)',
      }}
    >
      <p className="font-semibold mb-1" style={{ color: 'var(--pc-text-primary)' }}>
        {guide.title}
      </p>
      <p>{guide.body}</p>
      {guide.items && (
        <ul className="list-disc pl-5 mt-2 space-y-1">
          {guide.items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function guideFor(sectionKey: string, prefix: string): { title: string; body: string; items?: string[] } | null {
  if (prefix.startsWith('providers.models.')) {
    const provider = prefix.split('.')[2] ?? '';
    const local = isLocalModelProvider(provider);
    return {
      title: '配置此提供商',
      body: local
        ? '如果是本地提供商，请选择该别名要使用的模型，并确认本地服务或 CLI 端点可用。其余大多数参数都属于高级调优。'
        : '如果是托管提供商，请选择模型并填写 API Key 或支持的认证方式。大多数请求、格式化和成本字段可以先保留默认值。',
      items: local
        ? ['开始聊天前必须完成：模型，以及可访问的本地端点或 CLI。', '可选项：超时、温度、请求格式与计价字段。']
        : ['开始聊天前必须完成：模型，以及凭证或认证配置。', '可选项：超时、温度、请求格式与计价字段。'],
    };
  }
  if (sectionKey === 'risk-profiles') {
    return {
      title: '可复用的安全配置',
      body: '默认风险配置可以直接用于首次部署。如果你希望在创建智能体前调整工具、命令、路径或审批规则，可以在这里编辑。',
    };
  }
  if (sectionKey === 'runtime-profiles') {
    return {
      title: '可复用的运行时配置',
      body: '默认运行时配置可以直接用于首次部署。如果你希望调整智能体模式、迭代限制、超时、成本限制或上下文行为，可以在这里编辑。',
    };
  }
  if (sectionKey === 'storage') {
    return {
      title: '存储后端实例',
      body: '大多数单节点部署只需要一个名为 default 的 SQLite 实例。只有当不同智能体或环境确实需要多个存储后端时，才需要额外创建别名。',
    };
  }
  if (sectionKey === 'memory') {
    return {
      title: '持久化记忆后端',
      body: '本地首次部署默认使用 SQLite。只有当你想完全关闭长期记忆时，才应该选择 none。',
    };
  }
  if (sectionKey === 'agents') {
    return {
      title: '可运行智能体检查清单',
      body: '这就是你后续要聊天的智能体。只有在它已启用，并正确指向前面配置好的提供商和各类配置文件后，完成按钮才会出现。',
    };
  }
  return null;
}

const AGENT_FIRST_RUN_FIELDS = ['enabled', 'model-provider', 'risk-profile', 'runtime-profile'];

function isAgentFirstRunPath(prefix: string, path: string): boolean {
  return AGENT_FIRST_RUN_FIELDS.some((field) => path === `${prefix}.${field}`);
}

function FirstRunCompleteActions({
  canFinish,
  finishing,
  onFinish,
  onAdvanced,
}: {
  canFinish: boolean;
  finishing: boolean;
  onFinish: () => void;
  onAdvanced: () => void;
}) {
  return (
    <div
      className="rounded-xl border p-4 text-sm flex flex-col gap-3"
      style={{
        background: 'var(--pc-bg-surface-subtle)',
        borderColor: 'var(--pc-border)',
        color: 'var(--pc-text-secondary)',
      }}
    >
      <div>
        <p className="font-semibold mb-1" style={{ color: 'var(--pc-text-primary)' }}>
          {canFinish ? '基础设置已就绪，可直接应用' : '请先完成必需的绑定与分配'}
        </p>
        <p>
          {canFinish
            ? '后续可选的高级设置包括技能、技能包、MCP、频道、对等组、定时任务、隧道、TTS 和转录提供商。'
            : '请先完成上面的模型提供商、风险配置和运行时配置。高级设置可以等智能体能够正常回复后再继续。'}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {canFinish ? (
          <button
            type="button"
            className="btn-electric text-sm px-4 py-2"
            disabled={finishing}
            onClick={onFinish}
          >
            {finishing ? t('onboard.finishing') : t('onboard.finish')}
          </button>
        ) : (
          <p className="text-sm" style={{ color: 'var(--color-status-error)' }}>
            完成按钮会在必需的智能体绑定全部完成后出现。
          </p>
        )}
        <button
          type="button"
          className="btn-secondary text-sm px-4 py-2"
          onClick={onAdvanced}
        >
          继续高级设置
        </button>
      </div>
    </div>
  );
}

const AgentFirstRunForm = forwardRef<FieldFormHandle, {
  prefix: string;
  title: string;
  onSaved: () => void;
}>(function AgentFirstRunForm({ prefix, title, onSaved }, ref) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  return (
    <div className="flex flex-col gap-4">
      <div
        className="rounded-xl border p-4 text-sm"
        style={{
          background: 'var(--pc-bg-surface-subtle)',
          borderColor: 'var(--pc-border)',
          color: 'var(--pc-text-secondary)',
        }}
      >
        <p className="font-semibold mb-1" style={{ color: 'var(--pc-text-primary)' }}>
          智能体绑定
        </p>
        <p>
          请确认该智能体使用的模型提供商、风险配置和运行时配置。首次引导会在存在默认项时自动预选。
        </p>
      </div>
      <FieldForm
        ref={ref}
        prefix={prefix}
        title={title}
        showDelete={false}
        includePath={(path) => isAgentFirstRunPath(prefix, path)}
        onSaved={onSaved}
      />
      <div>
        <button
          type="button"
          className="btn-secondary text-sm px-4 py-2"
          onClick={() => setShowAdvanced((show) => !show)}
        >
          {showAdvanced ? '隐藏智能体高级设置' : '显示智能体高级设置'}
        </button>
      </div>
      {showAdvanced && (
        <FieldForm
          prefix={prefix}
          title="智能体高级设置"
          includePath={(path) => !isAgentFirstRunPath(prefix, path)}
          onSaved={onSaved}
        />
      )}
    </div>
  );
});

function isDefaultProfileSection(sectionKey: string): boolean {
  return sectionKey === 'risk-profiles' || sectionKey === 'runtime-profiles';
}

function DefaultProfileSummary({
  sectionKey,
  prefix,
  onEdit,
  onContinue,
  onPresetApplied,
}: {
  sectionKey: string;
  prefix: string;
  onEdit: () => void;
  onContinue: () => void;
  onPresetApplied: () => void;
}) {
  const [savingPreset, setSavingPreset] = useState<string | null>(null);
  const [appliedPreset, setAppliedPreset] = useState<string | null>(null);
  const isRisk = sectionKey === 'risk-profiles';
  const alias = prefix.split('.').slice(-1)[0] ?? 'default';
  const applyRiskPreset = async (preset: RiskPreset) => {
    setSavingPreset(preset.key);
    try {
      await patchConfig(riskPresetOps(prefix, preset));
      setAppliedPreset(preset.key);
      onPresetApplied();
    } finally {
      setSavingPreset(null);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div
        className="rounded-xl border p-4 text-sm"
        style={{
          background: 'var(--pc-bg-surface-subtle)',
          borderColor: 'var(--pc-border)',
          color: 'var(--pc-text-secondary)',
        }}
      >
        <p className="font-semibold mb-1" style={{ color: 'var(--pc-text-primary)' }}>
          {isRisk ? '风险配置已创建' : '运行时配置已创建'}
        </p>
        <p>
          {isRisk
            ? `智能体设置可以直接使用风险配置 ${alias}。如果你希望采用不同的安全策略，可以继续编辑。`
            : `智能体设置可以直接使用运行时配置 ${alias}。如果你想调整智能体模式、迭代限制、超时、成本限制或上下文行为，可以继续编辑。`}
        </p>
      </div>

      {isRisk && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {RISK_PRESETS.map((preset) => (
            <button
              key={preset.key}
              type="button"
              onClick={() => void applyRiskPreset(preset)}
              disabled={savingPreset !== null}
              className="rounded-xl border p-3 text-left transition-colors hover:opacity-90"
              style={{
                borderColor:
                  appliedPreset === preset.key ? 'var(--pc-accent)' : 'var(--pc-border)',
                background:
                  appliedPreset === preset.key ? 'var(--pc-accent-glow)' : 'var(--pc-bg-surface)',
                color: 'var(--pc-text-secondary)',
              }}
            >
              <span className="flex items-center justify-between gap-2 text-sm font-semibold" style={{ color: 'var(--pc-text-primary)' }}>
                <span>{savingPreset === preset.key ? '应用中...' : preset.label}</span>
                {appliedPreset === preset.key && (
                  <span className="text-xs" style={{ color: 'var(--pc-accent)' }}>
                    已选择
                  </span>
                )}
              </span>
              <span className="block text-xs mt-1">{preset.description}</span>
              {preset.warning && (
                <span className="block text-xs mt-2" style={{ color: 'var(--color-status-error)' }}>
                  {preset.warning}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {isRisk && appliedPreset && (
        <p className="text-sm" style={{ color: 'var(--color-status-success)' }}>
          已将 {RISK_PRESETS.find((preset) => preset.key === appliedPreset)?.label ?? '预设'} 应用到 {alias}。
        </p>
      )}

      <div className="flex items-center gap-2">
        <button type="button" className="btn-electric text-sm px-4 py-2" onClick={onContinue}>
          继续
        </button>
        <button type="button" className="btn-secondary text-sm px-4 py-2" onClick={onEdit}>
          编辑配置
        </button>
      </div>
    </div>
  );
}

function MemoryBackendSummary({
  item,
  onEdit,
  onContinue,
}: {
  item: PickerItem;
  onEdit: () => void;
  onContinue: () => void;
}) {
  const disabled = item.key === 'none';
  return (
    <div className="flex flex-col gap-4">
      <div
        className="rounded-xl border p-4 text-sm"
        style={{
          background: 'var(--pc-bg-surface-subtle)',
          borderColor: 'var(--pc-border)',
          color: 'var(--pc-text-secondary)',
        }}
      >
        <p className="font-semibold mb-1" style={{ color: 'var(--pc-text-primary)' }}>
          已选择记忆后端
        </p>
        <p>
          {disabled
            ? '当前配置已关闭持久化记忆。你之后仍可在配置页中重新启用记忆后端。'
            : `当前已将 ${item.label} 设为持久化记忆后端。大多数首次部署都可以直接使用这个默认设置。`}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <button type="button" className="btn-electric text-sm px-4 py-2" onClick={onContinue}>
          继续
        </button>
        <button type="button" className="btn-secondary text-sm px-4 py-2" onClick={onEdit}>
          编辑记忆设置
        </button>
      </div>
    </div>
  );
}

interface RiskPreset {
  key: string;
  label: string;
  description: string;
  warning?: string;
  level: 'readonly' | 'supervised' | 'full';
  allowedCommands: string[];
  requireApprovalForMediumRisk: boolean;
  blockHighRiskCommands: boolean;
}

const RISK_PRESETS: RiskPreset[] = [
  {
    key: 'read_only',
    label: '只读',
    description: '偏检查模式：Shell 命令受限，中风险操作仍需审批。',
    level: 'readonly',
    allowedCommands: ['git', 'ls', 'pwd', 'cat', 'head', 'tail', 'rg', 'sed'],
    requireApprovalForMediumRisk: true,
    blockHighRiskCommands: true,
  },
  {
    key: 'balanced',
    label: '平衡默认',
    description: '适合作为首次部署默认方案：常用开发工具可用，中风险需审批，高风险命令被拦截。',
    level: 'supervised',
    allowedCommands: [
      'git',
      'npm',
      'cargo',
      'ls',
      'cat',
      'grep',
      'rg',
      'sed',
      'head',
      'tail',
      'find',
      'mkdir',
      'touch',
      'python',
      'python3',
      'node',
      'curl',
      'tar',
      'unzip',
      'which',
      'pwd',
      'date',
    ],
    requireApprovalForMediumRisk: true,
    blockHighRiskCommands: true,
  },
  {
    key: 'local_dev',
    label: '本地开发',
    description: '适合可信的本地工作区，权限更宽松，但仍会拦截高风险命令模式。',
    level: 'full',
    allowedCommands: [
      'git',
      'gh',
      'npm',
      'npx',
      'node',
      'cargo',
      'rustc',
      'python',
      'python3',
      'uv',
      'ls',
      'cat',
      'grep',
      'rg',
      'sed',
      'head',
      'tail',
      'find',
      'mkdir',
      'touch',
      'curl',
      'tar',
      'unzip',
      'which',
      'pwd',
      'date',
    ],
    requireApprovalForMediumRisk: false,
    blockHighRiskCommands: true,
  },
  {
    key: 'yolo',
    label: 'YOLO',
    description: '适合可信且可丢弃的本地工作区，提供最高自治能力。',
    warning: '除非你完全理解风险，否则不建议使用。',
    level: 'full',
    allowedCommands: [
      'git',
      'gh',
      'npm',
      'npx',
      'node',
      'cargo',
      'rustc',
      'python',
      'python3',
      'uv',
      'bash',
      'sh',
      'zsh',
      'make',
      'docker',
      'curl',
      'tar',
      'unzip',
      'ls',
      'cat',
      'grep',
      'rg',
      'sed',
      'head',
      'tail',
      'find',
      'mkdir',
      'touch',
      'cp',
      'mv',
      'rm',
      'chmod',
      'which',
      'pwd',
      'date',
    ],
    requireApprovalForMediumRisk: false,
    blockHighRiskCommands: false,
  },
];

function riskPresetOps(prefix: string, preset: RiskPreset) {
  return [
    { op: 'replace' as const, path: `${prefix}.level`, value: preset.level },
    { op: 'replace' as const, path: `${prefix}.allowed-commands`, value: preset.allowedCommands },
    {
      op: 'replace' as const,
      path: `${prefix}.require-approval-for-medium-risk`,
      value: preset.requireApprovalForMediumRisk,
    },
    {
      op: 'replace' as const,
      path: `${prefix}.block-high-risk-commands`,
      value: preset.blockHighRiskCommands,
    },
  ];
}

function isLocalModelProvider(provider: string): boolean {
  return isLocalModelProviderName(provider);
}

function capitalize(value: string): string {
  return value.length === 0 ? value : value.charAt(0).toUpperCase() + value.slice(1);
}

function OnboardAliasListView({
  sectionKey,
  typeKey,
  typeLabel,
  onSelectAlias,
}: {
  sectionKey: string;
  typeKey: string;
  typeLabel: string;
  onSelectAlias: (alias: string) => Promise<void>;
}) {
  const [aliases, setAliases] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [newAlias, setNewAlias] = useState('');
  const [aliasError, setAliasError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const mapPath = `${sectionKey}.${typedMapPathSegment(sectionKey, typeKey)}`;
  const aliasHelpLabel = typedAliasHelpLabel(sectionKey, typeLabel);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getMapKeys(mapPath)
      .then((r) => { if (!cancelled) setAliases(r.keys); })
      .catch(() => { if (!cancelled) setAliases([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [mapPath]);

  const submit = async () => {
    const trimmed = newAlias.trim() || suggestAlias(aliases);
    setAliasError(null);
    const validationError = validateAlias(trimmed);
    if (validationError) {
      setAliasError(validationError);
      return;
    }
    try {
      await onSelectAlias(trimmed);
    } catch (e) {
      setAliasError(
        e instanceof ApiError ? e.envelope.message : (e instanceof Error ? e.message : String(e)),
      );
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm" style={{ color: 'var(--pc-text-secondary)' }}>
        {sectionKey === 'channels' ? t('channels.alias_intro') : `${typeLabel}：先选择已有别名，或创建一个新的配置项。`}
      </p>
      {sectionKey === 'channels' && isSupportedChannelGuide(typeKey) && (
        <ChannelSetupGuide channelKey={typeKey} mode="alias" />
      )}
      <AliasHelpBox what={aliasHelpLabel} />
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="h-8 w-8 border-2 rounded-full animate-spin"
            style={{ borderColor: 'var(--pc-border)', borderTopColor: 'var(--pc-accent)' }} />
        </div>
      ) : (
        <>
          {error && (
            <div
              className="rounded-xl border p-3 text-sm"
              style={{ background: 'rgba(239,68,68,0.08)', borderColor: 'rgba(239,68,68,0.2)', color: '#f87171' }}
            >
              {error}
            </div>
          )}
          <div className="surface-panel divide-y" style={{ borderColor: 'var(--pc-border)' }}>
          {aliases.map((alias) => (
            <button
              key={alias}
              type="button"
              onClick={() => {
                onSelectAlias(alias).catch((e) => {
                  setError(
                    e instanceof ApiError
                      ? `[${e.envelope.code}] ${e.envelope.message}`
                      : (e instanceof Error ? e.message : String(e)),
                  );
                });
              }}
              className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left text-sm transition-colors hover:opacity-90"
            >
              <div>
                <span style={{ color: 'var(--pc-text-primary)', fontWeight: 500 }}>{alias}</span>
                <code className="block text-xs mt-0.5" style={{ color: 'var(--pc-text-faint)' }}>
                  {mapPath}.{alias}
                </code>
              </div>
              <ChevronRight className="h-4 w-4 flex-shrink-0" style={{ color: 'var(--pc-text-muted)' }} />
            </button>
          ))}
          <div className="flex flex-col gap-1 px-4 py-3">
            <div className="flex items-center gap-2">
              <input
                type="text"
                className="input-electric flex-1 px-3 py-1.5 text-sm"
                placeholder={suggestAlias(aliases)}
                value={newAlias}
                onChange={(e) => { setNewAlias(e.target.value); setAliasError(null); }}
                onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }}
                // eslint-disable-next-line jsx-a11y/no-autofocus
                autoFocus={aliases.length === 0}
              />
              <button type="button" onClick={() => void submit()} className="btn-electric text-sm px-3 py-1.5 flex-shrink-0">
                {t('common.create')}
              </button>
            </div>
            {aliasError && (
              <p className="text-xs" style={{ color: 'var(--color-status-error)' }}>{aliasError}</p>
            )}
          </div>
        </div>
        </>
      )}
    </div>
  );
}

/// Help block shown above every alias-input field (one-tier and typed-family
/// alike) so the user knows what they're naming and what the rules are.
/// Constraints come from `validate_alias_key` in zeroclaw-config — keep this
/// blurb in sync with that validator's rules if they ever loosen.
function AliasHelpBox({ what }: { what: string }) {
  return (
    <div
      className="rounded-md border px-3 py-2 text-xs"
      style={{
        borderColor: 'var(--pc-border)',
        background: 'var(--pc-bg-surface-subtle)',
        color: 'var(--pc-text-secondary)',
      }}
    >
      <p className="mb-1">
        <strong>{what} 别名。</strong> {aliasHelpText(what)}
      </p>
      <p className="mb-0">
        {t('config.alias_rules')}
      </p>
    </div>
  );
}

function OnboardOneTierAliasView({
  sectionKey,
  onSelectAlias,
}: {
  sectionKey: string;
  onSelectAlias: (alias: string) => Promise<void>;
}) {
  const [aliases, setAliases] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [newAlias, setNewAlias] = useState('');
  const [aliasError, setAliasError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getMapKeys(sectionKey)
      .then((r) => { if (!cancelled) setAliases(r.keys); })
      .catch(() => { if (!cancelled) setAliases([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [sectionKey]);

  const submit = async () => {
    const trimmed = newAlias.trim() || suggestAlias(aliases);
    setAliasError(null);
    const validationError = validateAlias(trimmed);
    if (validationError) {
      setAliasError(validationError);
      return;
    }
    try {
      await onSelectAlias(trimmed);
    } catch (e) {
      setAliasError(
        e instanceof ApiError ? e.envelope.message : (e instanceof Error ? e.message : String(e)),
      );
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="h-8 w-8 border-2 rounded-full animate-spin"
          style={{ borderColor: 'var(--pc-border)', borderTopColor: 'var(--pc-accent)' }} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <AliasHelpBox what={oneTierAliasHelpLabel(sectionKey)} />
      {sectionKey === 'agents' && (
        <p className="text-sm" style={{ color: 'var(--pc-text-secondary)' }}>
          创建或选择你后续要聊天的智能体。前面已经配置好的提供商和配置文件会在可用时自动预选。
        </p>
      )}
      {error && (
        <div
          className="rounded-xl border p-3 text-sm"
          style={{ background: 'rgba(239,68,68,0.08)', borderColor: 'rgba(239,68,68,0.2)', color: '#f87171' }}
        >
          {error}
        </div>
      )}
      <div className="surface-panel divide-y" style={{ borderColor: 'var(--pc-border)' }}>
        {aliases.map((alias) => (
          <button
            key={alias}
            type="button"
            onClick={() => {
              onSelectAlias(alias).catch((e) => {
                setError(
                  e instanceof ApiError
                    ? `[${e.envelope.code}] ${e.envelope.message}`
                    : (e instanceof Error ? e.message : String(e)),
                );
              });
            }}
            className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left text-sm transition-colors hover:opacity-90"
          >
            <div>
              <span style={{ color: 'var(--pc-text-primary)', fontWeight: 500 }}>{alias}</span>
              <code className="block text-xs mt-0.5" style={{ color: 'var(--pc-text-faint)' }}>
                {sectionKey}.{alias}
              </code>
            </div>
            <ChevronRight className="h-4 w-4 flex-shrink-0" style={{ color: 'var(--pc-text-muted)' }} />
          </button>
        ))}
        <div className="flex flex-col gap-1 px-4 py-3">
          <div className="flex items-center gap-2">
            <input
              type="text"
              className="input-electric flex-1 px-3 py-1.5 text-sm"
              placeholder={suggestAlias(aliases)}
              value={newAlias}
              onChange={(e) => { setNewAlias(e.target.value); setAliasError(null); }}
              onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }}
              // eslint-disable-next-line jsx-a11y/no-autofocus
              autoFocus={aliases.length === 0}
            />
            <button type="button" onClick={() => void submit()} className="btn-electric text-sm px-3 py-1.5 flex-shrink-0">
              {t('common.create')}
            </button>
          </div>
          {aliasError && (
            <p className="text-xs" style={{ color: 'var(--color-status-error)' }}>{aliasError}</p>
          )}
        </div>
      </div>
    </div>
  );
}

function isLastSection(sections: SectionInfo[], key: string): boolean {
  return sections[sections.length - 1]?.key === key;
}

function suggestAlias(aliases: string[]): string {
  const used = new Set(aliases);
  if (!used.has('default')) return 'default';
  for (let i = 2; i < 100; i += 1) {
    const candidate = `default_${i}`;
    if (!used.has(candidate)) return candidate;
  }
  return 'default_100';
}

function validateAlias(alias: string): string | null {
  if (/^(?!_)(?!.*__)(?!.*_$)[a-z0-9_]{1,63}$/.test(alias)) return null;
  return t('config.alias_invalid');
}

function aliasHelpText(what: string): string {
  const normalized = what.toLowerCase();
  if (normalized.includes('agent')) {
    return '这是你后续要聊天的智能体名称。首次部署通常只需要一个名为 default 的智能体。';
  }
  if (normalized.includes('risk')) {
    return '这是可复用的安全配置名称。首次部署通常只需要 default，后续由智能体引用。';
  }
  if (normalized.includes('runtime')) {
    return '这是可复用的运行时配置名称，用于工具限制、超时和智能体行为。首次部署通常只需要 default。';
  }
  if (normalized.includes('provider')) {
    return '这是某个提供商凭据或端点的名称，例如 default、work 或 local。智能体会按 provider.alias 引用它。';
  }
  if (normalized.includes('storage')) {
    return '这是某个存储后端实例的名称。首次部署通常只需要一个名为 default 的实例。';
  }
  if (normalized.includes('channel')) {
    return '这是某个渠道连接的名称。后续智能体可以直接引用这个渠道别名。';
  }
  return '这是一个可复用配置项的名称。首次部署通常只需要 default，只有确实需要多份配置时再新增别名。';
}

function typedAliasHelpLabel(sectionKey: string, typeLabel: string): string {
  switch (sectionKey) {
    case 'providers.models':
      return `${typeLabel} provider`;
    case 'providers.tts':
      return `${typeLabel} TTS provider`;
    case 'providers.transcription':
      return `${typeLabel} transcription provider`;
    case 'storage':
      return `${capitalize(typeLabel)} storage`;
    case 'channels':
      return `${typeLabel} channel`;
    default:
      return typeLabel;
  }
}

function oneTierAliasHelpLabel(sectionKey: string): string {
  switch (sectionKey) {
    case 'agents':
      return 'Agent';
    case 'risk-profiles':
      return 'Risk profile';
    case 'runtime-profiles':
      return 'Runtime profile';
    case 'skill-bundles':
      return 'Skill bundle';
    case 'mcp-bundles':
      return 'MCP bundle';
    case 'knowledge-bundles':
      return 'Knowledge bundle';
    case 'peer-groups':
      return 'Peer group';
    default:
      return 'Entry';
  }
}

function typedMapPathSegment(sectionKey: string, typeKey: string): string {
  return sectionKey.startsWith('providers.') ? typeKey.replace(/_/g, '-') : typeKey;
}

function isSupportedChannelGuide(channelKey?: string): channelKey is 'wechat' | 'qq' | 'wecom' {
  return channelKey === 'wechat' || channelKey === 'qq' || channelKey === 'wecom';
}

function parseCompleted(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string');
  if (typeof v !== 'string' || !v.length || v === '<unset>') return [];
  try {
    const parsed = JSON.parse(v);
    if (Array.isArray(parsed)) {
      return parsed.filter((x): x is string => typeof x === 'string');
    }
  } catch {
    // CLI-display fallback: comma-separated.
  }
  return v.split(',').map((s) => s.trim()).filter(Boolean);
}
