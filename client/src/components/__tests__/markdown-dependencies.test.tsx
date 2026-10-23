import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Streamdown } from "streamdown";
import { chatRehypePlugins } from "@/lib/chat-markdown";

// Exercise the real consumer without browser-only lazy CSS loading.
describe("chat markdown dependency compatibility", () => {
  it("renders inline and display math through Streamdown", () => {
    const html = renderToStaticMarkup(
      <Streamdown mode="static" rehypePlugins={chatRehypePlugins}>
        {"Inline $$x^2$$\n\n$$\n\\frac{a}{b}\n$$"}
      </Streamdown>
    );
    expect(html).toContain('class="katex"');
    expect(html).toContain("katex-display");
    expect(html).toContain("<math");
  });

  it("keeps unsafe HTML and script URLs out of rendered markdown", () => {
    const html = renderToStaticMarkup(
      <Streamdown mode="static" rehypePlugins={chatRehypePlugins}>
        {
          "<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n[unsafe](javascript:alert(1))\n\n**Safe text**"
        }
      </Streamdown>
    );
    expect(html).not.toMatch(/<script\b/i);
    expect(html).not.toMatch(/href=["\']javascript:/i);
    expect(html).not.toMatch(/onerror=/i);
    expect(html).toContain('data-streamdown="strong"');
    expect(html).toContain("Safe text");
  });
});
