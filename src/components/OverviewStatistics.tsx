import { BookOpen, Image, MessageCircle, Sparkles } from "lucide-react";
import type { HistoryTotals } from "../shared/history";

export function OverviewStatistics({
  name,
  stats,
}: {
  name: string;
  stats?: HistoryTotals;
}) {
  const metrics = [
    {
      label: "Conversations",
      value: stats?.conversations,
      icon: BookOpen,
      tone: "lilac",
      detail: "Every chapter, kept.",
    },
    {
      label: "Messages",
      value: stats?.messages,
      icon: MessageCircle,
      tone: "mint",
      detail: "Your words and hers.",
    },
    {
      label: "Shared images",
      value: stats?.images,
      icon: Image,
      tone: "peach",
      detail: "Little glimpses of your world.",
    },
  ];
  return (
    <section
      className="overview-statistics"
      aria-labelledby="overview-statistics-title"
    >
      <header>
        <div>
          <span className="eyebrow">A LITTLE HISTORY, TOGETHER</span>
          <h2 id="overview-statistics-title">Your story so far</h2>
        </div>
        <span className="overview-stats-scope">
          <Sparkles size={13} />
          {name}’s saved history
        </span>
      </header>
      <dl className="overview-statistics-grid">
        {metrics.map(({ label, value, icon: Icon, tone, detail }) => (
          <div className={`overview-metric ${tone}`} key={label}>
            <dt>
              <span className="overview-metric-icon">
                <Icon size={17} />
              </span>
              {label}
            </dt>
            <dd>
              <strong>
                {value === undefined ? "—" : value.toLocaleString()}
              </strong>
              <span>{detail}</span>
            </dd>
          </div>
        ))}
      </dl>
      <p className="overview-stats-note">
        {stats
          ? "All saved sessions · Desktop + Telegram · Updates as you chat"
          : "Statistics unavailable · Reopen the updated desktop app"}
      </p>
    </section>
  );
}
