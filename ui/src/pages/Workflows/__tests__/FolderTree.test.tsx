// Copyright GraphCaster. All Rights Reserved.

import { describe, expect, it, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { FolderTree } from "../FolderTree";
import { seedWorkflowsStore } from "./testHelpers";

describe("FolderTree", () => {
  beforeEach(() => {
    seedWorkflowsStore({
      folders: [
        { id: "f1", name: "Parent", parentId: null },
        { id: "f2", name: "Child", parentId: "f1" },
      ],
    });
  });

  it("expands and collapses a folder node when clicked", () => {
    const handle = (_id: string | null) => undefined;
    render(<FolderTree selectedFolderId={null} onSelect={handle} />);
    expect(screen.queryByTestId("folder-node-f2")).toBeNull();
    fireEvent.click(screen.getByTestId("folder-node-f1"));
    expect(screen.getByTestId("folder-node-f2")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("folder-node-f1"));
    expect(screen.queryByTestId("folder-node-f2")).toBeNull();
  });

  it("double-click selects a folder", () => {
    let selected: string | null | undefined;
    const handle = (id: string | null) => {
      selected = id;
    };
    render(<FolderTree selectedFolderId={null} onSelect={handle} />);
    fireEvent.doubleClick(screen.getByTestId("folder-node-f1"));
    expect(selected).toBe("f1");
  });
});
