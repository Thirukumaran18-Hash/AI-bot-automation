import { Fragment, type ReactNode } from "react";

function renderInline(value: string): ReactNode[] {
  return value
    .split(/(\*\*[^*]+\*\*|`[^`]+`)/g)
    .filter(Boolean)
    .map((part, index) => {
      if (part.startsWith("**") && part.endsWith("**")) {
        return <strong key={index}>{part.slice(2, -2)}</strong>;
      }
      if (part.startsWith("`") && part.endsWith("`")) {
        return <code key={index}>{part.slice(1, -1)}</code>;
      }
      return <Fragment key={index}>{part}</Fragment>;
    });
}

export function Markdown({ text, className = "brief-block" }: { text: string; className?: string }) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let listItems: string[] = [];
  let ordered = false;

  const flushList = () => {
    if (listItems.length === 0) return;
    const items = listItems.map((item, index) => <li key={index}>{renderInline(item)}</li>);
    blocks.push(
      ordered ? (
        <ol key={`list-${blocks.length}`}>{items}</ol>
      ) : (
        <ul key={`list-${blocks.length}`}>{items}</ul>
      ),
    );
    listItems = [];
  };

  lines.forEach((raw, index) => {
    const line = raw.trim();
    if (!line) {
      flushList();
      return;
    }

    const heading = line.match(/^#{1,4}\s+(.*)$/);
    if (heading) {
      flushList();
      blocks.push(<h4 key={`heading-${index}`}>{renderInline(heading[1])}</h4>);
      return;
    }

    const bullet = line.match(/^[-*]\s+(.*)$/);
    if (bullet) {
      if (listItems.length > 0 && ordered) flushList();
      ordered = false;
      listItems.push(bullet[1]);
      return;
    }

    const numbered = line.match(/^\d+\.\s+(.*)$/);
    if (numbered) {
      if (listItems.length > 0 && !ordered) flushList();
      ordered = true;
      listItems.push(numbered[1]);
      return;
    }

    flushList();
    blocks.push(<p key={`paragraph-${index}`}>{renderInline(line)}</p>);
  });

  flushList();

  return <div className={className}>{blocks}</div>;
}
