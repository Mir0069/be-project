import { useMemo } from "react";
import { sanitizeEmailHtml } from "./sanitizeEmailHtml";

interface EmailBodyProps {
  html?: string | null;
  text?: string | null;
}

const EmailBody = ({ html, text }: EmailBodyProps) => {
  const safeHtml = useMemo(
    () => (html?.trim() ? sanitizeEmailHtml(html) : ""),
    [html],
  );

  if (!safeHtml) {
    return (
      <div className="whitespace-pre-wrap break-words text-sm leading-6 text-gray-700">
        {text?.trim() || "No email body text available."}
      </div>
    );
  }

  return (
    <div
      className="break-words text-sm leading-6 text-gray-700 [&_a]:text-blue-700 [&_a]:underline [&_blockquote]:my-3 [&_blockquote]:border-l-2 [&_blockquote]:border-gray-300 [&_blockquote]:pl-3 [&_li]:my-1 [&_ol]:my-3 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:mb-3 [&_p:last-child]:mb-0 [&_pre]:my-3 [&_pre]:overflow-x-auto [&_pre]:whitespace-pre-wrap [&_table]:my-3 [&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:border-gray-200 [&_td]:p-2 [&_th]:border [&_th]:border-gray-200 [&_th]:bg-gray-50 [&_th]:p-2 [&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-5"
      dangerouslySetInnerHTML={{ __html: safeHtml }}
    />
  );
};

export default EmailBody;
