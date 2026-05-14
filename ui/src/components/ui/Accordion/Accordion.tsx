// Copyright GraphCaster. All Rights Reserved.

import React from "react";
import * as RxAccordion from "@radix-ui/react-accordion";

import { Icon } from "../Icon/Icon";
import "./Accordion.css";

export interface AccordionItem {
  id: string;
  title: React.ReactNode;
  content: React.ReactNode;
}

type AccordionSingleProps = {
  type?: "single";
  defaultValue?: string;
  value?: string;
  onValueChange?: (value: string) => void;
  collapsible?: boolean;
};

type AccordionMultipleProps = {
  type: "multiple";
  defaultValue?: string[];
  value?: string[];
  onValueChange?: (value: string[]) => void;
  collapsible?: never;
};

type AccordionVariantProps = AccordionSingleProps | AccordionMultipleProps;

type AccordionBaseProps = {
  items: AccordionItem[];
  className?: string;
};

export type AccordionProps = AccordionBaseProps & AccordionVariantProps;

export const Accordion = React.forwardRef<HTMLDivElement, AccordionProps>(
  (props, ref) => {
    const { items, className } = props;

    const rootClass = ["gc-accordion", className].filter(Boolean).join(" ");

    if (props.type === "multiple") {
      return (
        <RxAccordion.Root
          ref={ref}
          type="multiple"
          defaultValue={props.defaultValue}
          value={props.value}
          onValueChange={props.onValueChange}
          className={rootClass}
        >
          {items.map((item) => (
            <AccordionItemRow key={item.id} item={item} />
          ))}
        </RxAccordion.Root>
      );
    }

    return (
      <RxAccordion.Root
        ref={ref}
        type="single"
        defaultValue={props.defaultValue}
        value={props.value}
        onValueChange={props.onValueChange}
        collapsible={props.collapsible ?? true}
        className={rootClass}
      >
        {items.map((item) => (
          <AccordionItemRow key={item.id} item={item} />
        ))}
      </RxAccordion.Root>
    );
  },
);

Accordion.displayName = "Accordion";

function AccordionItemRow({ item }: { item: AccordionItem }) {
  return (
    <RxAccordion.Item value={item.id} className="gc-accordion__item">
      <RxAccordion.Header className="gc-accordion__header">
        <RxAccordion.Trigger className="gc-accordion__trigger">
          <span className="gc-accordion__trigger-title">{item.title}</span>
          <span className="gc-accordion__chevron" aria-hidden="true">
            <Icon name="chevron-down" size={14} />
          </span>
        </RxAccordion.Trigger>
      </RxAccordion.Header>
      <RxAccordion.Content className="gc-accordion__content">
        <div className="gc-accordion__content-inner">{item.content}</div>
      </RxAccordion.Content>
    </RxAccordion.Item>
  );
}
