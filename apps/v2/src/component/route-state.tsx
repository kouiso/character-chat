import { Link } from "@tanstack/react-router";

export type RouteStateProps = {
  state: "loading" | "error" | "offline" | "unavailable" | "empty";
  title: string;
  description: string;
  onRetry?: () => void;
};

export const RouteState = ({ state, title, description, onRetry }: RouteStateProps) => (
  <section className="v2-list" aria-label={title} data-chat-state={state}>
    <div role={state === "error" ? "alert" : "status"}>
      <h1>{title}</h1>
      <p>{description}</p>
    </div>
    <Link to="/">一覧に戻る</Link>
    {onRetry && (
      <button type="button" onClick={onRetry}>
        読み込みをやり直す
      </button>
    )}
  </section>
);
