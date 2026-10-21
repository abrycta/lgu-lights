import { Button, Page, useT } from "@abrycta/akari/react";
import { type MouseEvent, useEffect } from "react";

import { formatUrl, navigate, useUrlState } from "@/app/url";

/** Unknown paths: a real "not found" page (the Header marks nothing), with a way back to the map. */
export default function NotFoundPage() {
  const t = useT();
  const url = useUrlState();
  useEffect(() => {
    const before = document.title;
    document.title = `${t("Not found", "ページが見つかりません")} · Lights`;
    const robots = document.createElement("meta");
    robots.name = "robots";
    robots.content = "noindex";
    document.head.append(robots);
    return () => {
      document.title = before;
      robots.remove();
    };
  }, [t]);
  const go = (page: "map" | "about") => (e: MouseEvent) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    navigate({ page });
    window.scrollTo(0, 0);
  };
  return (
    <Page
      eyebrow="404"
      title={t("Nothing lights up here", "このページは見つかりません")}
      lede={t("There is nothing at this address. The link may be mistyped or out of date.", "このアドレスには何もありません。リンクの誤りか、古いリンクの可能性があります。")}
    >
      <div className="flex flex-wrap gap-3">
        <Button asChild>
          <a href={formatUrl({ ...url, page: "map" })} onClick={go("map")}>
            {t("Go to the map", "地図へ")}
          </a>
        </Button>
        <Button asChild variant="outline">
          <a href={formatUrl({ ...url, page: "about" })} onClick={go("about")}>
            {t("About & method", "概要と手法")}
          </a>
        </Button>
      </div>
    </Page>
  );
}
