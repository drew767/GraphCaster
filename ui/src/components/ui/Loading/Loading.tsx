// Copyright GraphCaster. All Rights Reserved.

import React from "react";

import { Spinner } from "../Spinner/Spinner";
import { CircleLoader } from "../CircleLoader/CircleLoader";
import "./Loading.css";

export type LoadingVariant = "fullscreen" | "inline" | "card";
export type LoadingSpinner = "default" | "circle" | "dots";

export interface LoadingProps {
  visible?: boolean;
  label?: string;
  variant?: LoadingVariant;
  spinner?: LoadingSpinner;
}

function DotsSpinner() {
  return (
    <span className="gc-loading__dots" aria-hidden="true">
      <span />
      <span />
      <span />
    </span>
  );
}

function SpinnerNode({
  kind,
  label,
}: {
  kind: LoadingSpinner;
  label?: string;
}) {
  if (kind === "circle") return <CircleLoader size={32} label={label ?? "Loading"} />;
  if (kind === "dots") return <DotsSpinner />;
  return <Spinner size={20} label={label ?? "Loading"} />;
}

export function Loading({
  visible = true,
  label,
  variant = "inline",
  spinner = "default",
}: LoadingProps) {
  if (!visible) return null;

  const classes = ["gc-loading", `gc-loading--${variant}`].join(" ");

  return (
    <div className={classes} aria-busy="true">
      <SpinnerNode kind={spinner} label={label} />
      {label && <span className="gc-loading__label">{label}</span>}
    </div>
  );
}
