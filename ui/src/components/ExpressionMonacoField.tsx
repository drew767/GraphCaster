// Copyright GraphCaster. All Rights Reserved.

import Editor, { type BeforeMount } from "@monaco-editor/react";

let languageRegistered = false;

const beforeMount: BeforeMount = (monaco) => {
  if (languageRegistered) {
    return;
  }
  languageRegistered = true;
  const id = "graphcaster-expression";
  monaco.languages.register({ id });
  monaco.languages.setMonarchTokensProvider(id, {
    tokenizer: {
      root: [
        [/\{\{/, "keyword"],
        [/\}\}/, "keyword"],
        [/\$[a-zA-Z_][\w]*/, "type.identifier"],
        [/"(?:[^"\\]|\\.)*"/, "string"],
        [/'(?:[^'\\]|\\.)*'/, "string"],
        [/\s+/, ""],
        [/./, "source"],
      ],
    },
  });
};

export type ExpressionMonacoFieldProps = {
  className?: string;
  value: string;
  onChange: (value: string) => void;
  readOnly?: boolean;
  disabled?: boolean;
  heightPx?: number;
  "aria-invalid"?: boolean;
  title?: string;
};

export default function ExpressionMonacoField({
  className,
  value,
  onChange,
  readOnly = false,
  disabled = false,
  heightPx = 120,
  "aria-invalid": ariaInvalid,
  title,
}: ExpressionMonacoFieldProps) {
  const ro = readOnly || disabled;
  return (
    <div
      className={className}
      title={title}
      aria-invalid={ariaInvalid === true ? true : undefined}
    >
      <Editor
        height={`${heightPx}px`}
        defaultLanguage="graphcaster-expression"
        language="graphcaster-expression"
        value={value}
        theme="vs"
        beforeMount={beforeMount}
        options={{
          readOnly: ro,
          domReadOnly: ro,
          minimap: { enabled: false },
          fontSize: 13,
          scrollBeyondLastLine: false,
          wordWrap: "on",
          automaticLayout: true,
          tabSize: 2,
          lineNumbers: "off",
          folding: false,
          glyphMargin: false,
          lineDecorationsWidth: 8,
          lineNumbersMinChars: 0,
          overviewRulerLanes: 0,
          hideCursorInOverviewRuler: true,
          overviewRulerBorder: false,
        }}
        onChange={(v) => {
          if (!ro) {
            onChange(v ?? "");
          }
        }}
      />
    </div>
  );
}
