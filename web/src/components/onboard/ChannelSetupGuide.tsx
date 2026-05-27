import { t } from '../../lib/i18n';

interface ChannelSetupGuideProps {
  channelKey: 'wechat' | 'qq' | 'wecom';
  mode: 'alias' | 'form';
}

export default function ChannelSetupGuide({ channelKey, mode }: ChannelSetupGuideProps) {
  const title = t(`channels.${channelKey}.${mode}.title`);
  const body = t(`channels.${channelKey}.${mode}.body`);
  const tips = [1, 2, 3]
    .map((index) => t(`channels.${channelKey}.${mode}.tip${index}`))
    .filter((value, idx, arr) => value !== `channels.${channelKey}.${mode}.tip${idx + 1}` && value.trim().length > 0);

  return (
    <div
      className="rounded-xl border p-4 flex flex-col gap-3"
      style={{
        borderColor: 'var(--pc-border)',
        background: 'var(--pc-bg-surface-subtle)',
      }}
    >
      <div className="flex flex-col gap-1">
        <h3
          className="text-sm font-semibold"
          style={{ color: 'var(--pc-text-primary)' }}
        >
          {title}
        </h3>
        <p
          className="text-sm leading-relaxed"
          style={{ color: 'var(--pc-text-secondary)' }}
        >
          {body}
        </p>
      </div>

      {tips.length > 0 && (
        <ul
          className="text-xs space-y-1.5 list-disc pl-4"
          style={{ color: 'var(--pc-text-secondary)' }}
        >
          {tips.map((tip) => (
            <li key={tip}>{tip}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
