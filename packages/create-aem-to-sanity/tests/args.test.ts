import { describe, expect, it } from "vitest";

import { CliError, DEFAULT_REF, DEFAULT_REPO, parseCliArgs, validateSlug } from "../src/args.ts";

describe("parseCliArgs", () => {
  it("defaults to thin standalone mode with only a target dir", () => {
    const config = parseCliArgs(["my-migration"]);
    expect(config).toEqual({
      targetDir: "my-migration",
      tenant: undefined,
      repo: DEFAULT_REPO,
      ref: DEFAULT_REF,
      install: true,
      clone: false,
      detach: false,
      help: false,
      version: false,
    });
  });

  it("accepts no positional (prompted later)", () => {
    expect(parseCliArgs([]).targetDir).toBeUndefined();
  });

  it("parses clone mode with tenant, ref, repo", () => {
    const config = parseCliArgs([
      "dir",
      "--clone",
      "--tenant",
      "acme",
      "--ref",
      "v1.2.3",
      "--repo",
      "https://example.com/fork.git",
    ]);
    expect(config.clone).toBe(true);
    expect(config.tenant).toBe("acme");
    expect(config.ref).toBe("v1.2.3");
    expect(config.repo).toBe("https://example.com/fork.git");

    expect(parseCliArgs(["dir", "--no-install"]).install).toBe(false);
    expect(parseCliArgs(["dir", "--clone", "--detach"]).detach).toBe(true);
  });

  it("rejects clone-only flags without --clone", () => {
    expect(() => parseCliArgs(["dir", "--tenant", "acme"])).toThrow(/--clone/);
    expect(() => parseCliArgs(["dir", "--ref", "main"])).toThrow(/--clone/);
    expect(() => parseCliArgs(["dir", "--repo", "x"])).toThrow(/--clone/);
    expect(() => parseCliArgs(["dir", "--detach"])).toThrow(/--clone/);
  });

  it("supports short flags", () => {
    const config = parseCliArgs(["dir", "--clone", "-t", "acme", "-r", "main"]);
    expect(config.tenant).toBe("acme");
    expect(config.ref).toBe("main");
    expect(parseCliArgs(["-h"]).help).toBe(true);
  });

  it("parses --version / -v without a target dir", () => {
    expect(parseCliArgs(["--version"]).version).toBe(true);
    expect(parseCliArgs(["-v"]).version).toBe(true);
  });

  it("rejects extra positionals", () => {
    expect(() => parseCliArgs(["a", "b"])).toThrow(CliError);
  });

  it("rejects --tenant with --no-install", () => {
    expect(() => parseCliArgs(["dir", "--clone", "--tenant", "acme", "--no-install"])).toThrow(
      /--no-install/,
    );
  });

  it("rejects invalid tenant slugs", () => {
    expect(() => parseCliArgs(["dir", "--clone", "--tenant", "Acme"])).toThrow(CliError);
    expect(() => parseCliArgs(["dir", "--clone", "--tenant", "template"])).toThrow(/reserved/);
  });
});

describe("validateSlug", () => {
  it("accepts lowercase slugs with digits and hyphens", () => {
    expect(() => validateSlug("davids-bridal")).not.toThrow();
    expect(() => validateSlug("t2")).not.toThrow();
  });

  it("rejects uppercase, leading/trailing hyphens, and the reserved template slug", () => {
    for (const bad of ["Acme", "-acme", "acme-", "a_b", "template", ""]) {
      expect(() => validateSlug(bad), bad).toThrow(CliError);
    }
  });
});
