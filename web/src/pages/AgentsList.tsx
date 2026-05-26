import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Bot, Plus, AlertCircle } from 'lucide-react';
import AgentCard from '@/components/AgentCard';
import { loadAgentSummaries, toggleAgentEnabled, type AgentSummary } from '@/lib/agents';
import { getOnboardStatus } from '@/lib/api';
import { t } from '@/lib/i18n';

interface AgentSummariesState {
  loading: boolean;
  error: string | null;
  agents: AgentSummary[];
}

export default function AgentsList() {
  const [state, setState] = useState<AgentSummariesState>({
    loading: true,
    error: null,
    agents: [],
  });
  const [toggling, setToggling] = useState<Set<string>>(new Set());

  const refresh = useCallback(() => {
    setState((s) => ({ ...s, loading: true, error: null }));
    loadAgentSummaries()
      .then((agents) => setState({ loading: false, error: null, agents }))
      .catch((err: unknown) =>
        setState({
          loading: false,
          error: err instanceof Error ? err.message : t('agents.loading_error'),
          agents: [],
        }),
      );
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const toggleEnabled = useCallback(async (agent: AgentSummary) => {
    setToggling((prev) => new Set(prev).add(agent.alias));
    try {
      await toggleAgentEnabled(agent.alias, !agent.enabled);
      setState((s) => ({
        ...s,
        agents: s.agents.map((a) =>
          a.alias === agent.alias ? { ...a, enabled: !a.enabled } : a,
        ),
      }));
    } catch (err) {
      setState((s) => ({
        ...s,
        error: err instanceof Error ? err.message : t('agents.toggle_error').replace('{alias}', agent.alias),
      }));
    } finally {
      setToggling((prev) => {
        const next = new Set(prev);
        next.delete(agent.alias);
        return next;
      });
    }
  }, []);

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <header className="flex items-center justify-between mb-6">
        <div>
          <h1
            className="text-2xl font-semibold"
            style={{ color: 'var(--pc-text-primary)' }}
          >
            {t('agents.title')}
          </h1>
          <p className="text-sm mt-1" style={{ color: 'var(--pc-text-muted)' }}>
            {t('agents.subtitle')}
          </p>
        </div>
        <Link
          to="/config/agents"
          className="btn-electric flex items-center gap-2 px-4 py-2 rounded-xl text-sm"
        >
          <Plus className="h-4 w-4" />
          {t('agents.new')}
        </Link>
      </header>

      {state.error && (
        <div
          className="mb-4 px-4 py-3 rounded-xl border flex items-start gap-2 text-sm"
          style={{
            background: 'var(--color-status-error-alpha-08)',
            borderColor: 'var(--color-status-error-alpha-20)',
            color: 'var(--color-status-error)',
          }}
        >
          <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
          <span>{state.error}</span>
        </div>
      )}

      {state.loading && state.agents.length === 0 ? (
        <div
          className="rounded-2xl border p-8 text-center text-sm"
          style={{
            borderColor: 'var(--pc-border)',
            color: 'var(--pc-text-muted)',
          }}
        >
          {t('agents.loading')}
        </div>
      ) : state.agents.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {state.agents.map((agent) => (
            <AgentCard
              key={agent.alias}
              agent={agent}
              toggling={toggling.has(agent.alias)}
              onToggle={() => toggleEnabled(agent)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function EmptyState() {
  const [buttonLabel, setButtonLabel] = useState(t('agents.start_onboarding'));

  useEffect(() => {
    getOnboardStatus()
      .then((status) => {
        if (status.reason === 'has_dispatchable_agent') {
          setButtonLabel(t('agents.rerun_onboarding'));
        } else if (status.has_partial_state || status.reason === 'incomplete_agent') {
          setButtonLabel(t('agents.continue_onboarding'));
        } else {
          setButtonLabel(t('agents.start_onboarding'));
        }
      })
      .catch(() => setButtonLabel(t('agents.start_onboarding')));
  }, []);

  return (
    <div
      className="rounded-2xl border-2 border-dashed p-12 text-center"
      style={{ borderColor: 'var(--pc-border)' }}
    >
      <div
        className="h-12 w-12 rounded-2xl mx-auto mb-4 flex items-center justify-center"
        style={{ background: 'var(--pc-accent-glow)' }}
      >
        <Bot className="h-6 w-6" style={{ color: 'var(--pc-accent)' }} />
      </div>
      <p
        className="text-base font-medium mb-1"
        style={{ color: 'var(--pc-text-primary)' }}
      >
        {t('agents.empty_title')}
      </p>
      <p className="text-sm mb-4" style={{ color: 'var(--pc-text-muted)' }}>
        {t('agents.empty_hint')}
      </p>
      <Link
        to="/onboard"
        className="btn-electric inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm"
      >
        <Plus className="h-4 w-4" />
        {buttonLabel}
      </Link>
    </div>
  );
}
