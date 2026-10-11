import { useState } from "react";

import TextViewerDialog from "./TextViewerDialog";

// Beyond these limits the text is clipped to a preview and the full version opens in a popup.
const PREVIEW_MAX_CHARS = 400;
const PREVIEW_MAX_LINES = 6;

const isLongText = (text: string): boolean =>
  text.length > PREVIEW_MAX_CHARS || text.split("\n").length > PREVIEW_MAX_LINES;

interface ExpandableTextProps {
  text: string;
  /** Complete text for the popup when `text` is itself a shortened copy. */
  fullText?: string;
  title: string;
  subtitle?: string;
  className?: string;
}

/** Shows a few lines of long text with a "Read more" link that opens the full text in a popup. */
const ExpandableText = ({ text, fullText, title, subtitle, className = "" }: ExpandableTextProps) => {
  const [open, setOpen] = useState(false);
  const completeText = fullText ?? text;
  const isLong = completeText !== text || isLongText(text);

  return (
    <div>
      <p className={`whitespace-pre-line break-words ${isLong ? "line-clamp-6" : ""} ${className}`}>{text}</p>
      {isLong && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="mt-1.5 text-sm font-medium text-red-600 transition hover:text-red-700 hover:underline"
        >
          Read more
        </button>
      )}
      <TextViewerDialog
        open={open}
        title={title}
        subtitle={subtitle}
        text={completeText}
        onClose={() => setOpen(false)}
      />
    </div>
  );
};

export default ExpandableText;
