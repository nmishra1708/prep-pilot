import { describe, expect, it } from "vitest";
import sample from "./mock-serpapi.json";
import { buildJobQuery, normaliseJob, parseExperience, skillMatchScore } from "./search";

describe("job search helpers", () => {
  it("parses common experience requirements and leaves unstated experience empty", () => {
    expect(parseExperience("Requires 5+ years of experience with Node.js")).toBe(5);
    expect(parseExperience("Minimum 3 yrs experience")).toBe(3);
    expect(parseExperience("2-4 years of experience preferred")).toBe(2);
    expect(parseExperience("Experience with React is helpful")).toBeNull();
  });

  it("normalises sample Google Jobs response and calculates skill match", () => {
    const job = normaliseJob(sample.jobs_results[0]);
    expect(job).toMatchObject({
      id: "mock-node-react-indore",
      title: "Senior Full Stack Engineer (Node.js, React)",
      company: "Acme Product Labs",
      remote: true,
      experienceMatch: "Matches 5+ years",
      applyOptions: [
        { name: "Company site", link: "https://example.com/careers/full-stack-engineer" },
        { name: "LinkedIn", link: "https://www.linkedin.com/jobs/view/example" },
      ],
    });
    expect(job.highlights.qualifications.length).toBeGreaterThan(0);
    expect(skillMatchScore(job, ["Node.js", "React", "MongoDB", "Rust"])).toBe(75);
    const roundTripped = normaliseJob(job);
    expect(roundTripped.applyOptions).toEqual(job.applyOptions);
    expect(roundTripped.highlights).toEqual(job.highlights);
    expect(roundTripped.experienceMatch).toBe("Matches 5+ years");
    expect(normaliseJob(sample.jobs_results[2]).experienceMatch).toBe("Experience not stated");
  });

  it("builds the requested query without leaking other filter values into it", () => {
    expect(buildJobQuery({
      skills: ["Node.js", "React"],
      experienceMode: "years",
      years: 5,
      level: "Senior",
      location: "Indore, India",
      remote: false,
      postedWithin: "week",
      jobType: "full-time",
      sort: "newest",
    })).toBe("Node.js React 5 years jobs");
  });
});
