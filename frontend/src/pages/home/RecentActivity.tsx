import { Link } from "react-router-dom";
import { formatEnumLabel } from "../../lib/format";
import { STORY_TYPE_LABELS } from "../../types/taxonomy";
import type { StoryLibraryItem } from "../../lib/api";

export interface RecentActivityProps {
  stories: StoryLibraryItem[];
  loading: boolean;
}

export function RecentActivity({ stories, loading }: RecentActivityProps) {
  return (
    <section className="home__recent-activity">
      <h2 className="home__section-title">Recent Stories</h2>
      {loading ? (
        <div className="home__loading" role="status" aria-live="polite">
          Loading recent stories...
        </div>
      ) : stories.length === 0 ? (
        <p className="home__empty">
          No recent stories. <Link to="/accounts">Generate your first story</Link>
        </p>
      ) : (
        <div className="home__stories-list">
          {stories.map((story) => (
            <article key={story.id} className="home__story-card">
              <div className="home__story-header">
                <Link to={`/accounts/${story.account.id}`} className="home__story-account">
                  {story.account.name}
                </Link>
                <span className="home__story-date">
                  {new Date(story.generated_at).toLocaleDateString()}
                </span>
              </div>
              <h3 className="home__story-title">{story.title}</h3>
              <div className="home__story-meta">
                <span className="badge">{STORY_TYPE_LABELS[story.story_type] ?? formatEnumLabel(story.story_type)}</span>
                <span className="badge">{formatEnumLabel(story.story_status)}</span>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
