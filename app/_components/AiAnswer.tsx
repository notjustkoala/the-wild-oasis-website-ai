"use client";
import ReactMarkdown from "react-markdown";
import { cleanAiAnswer } from "../_lib/ai-answer-text";

export default function AiAnswer({ text }: { text: string }) {
  return <div className="ai-answer min-w-0 break-words leading-7"><ReactMarkdown
    allowedElements={["p","strong","em","ul","ol","li","h1","h2","h3","h4","code","pre","br"]}
    skipHtml unwrapDisallowed
    components={{ h1: ({children}) => <h3>{children}</h3>, h2: ({children}) => <h4>{children}</h4> }}
  >{cleanAiAnswer(text)}</ReactMarkdown></div>;
}
