import { describe, expect, it } from "vitest";
import { profileFilePath } from "../../src/settings/profile-path";

describe("profileFilePath", () => {
  it("uses backslashes for Windows Zotero profile dirs", () => {
    expect(
      profileFilePath(
        "C:\\Users\\Lenovo\\AppData\\Roaming\\Zotero\\Profiles\\abc.default",
        "zotero-ai-sidebar-repo-workspaces.json",
      ),
    ).toBe(
      "C:\\Users\\Lenovo\\AppData\\Roaming\\Zotero\\Profiles\\abc.default\\zotero-ai-sidebar-repo-workspaces.json",
    );
  });

  it("uses slashes for POSIX profile dirs", () => {
    expect(
      profileFilePath(
        "/Users/me/Zotero/Profiles/abc.default/",
        "zotero-ai-sidebar-repo-workspaces.json",
      ),
    ).toBe(
      "/Users/me/Zotero/Profiles/abc.default/zotero-ai-sidebar-repo-workspaces.json",
    );
  });
});
