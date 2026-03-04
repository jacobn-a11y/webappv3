import type { StoryContextSettings } from "./types";
import { request } from "./http";

export async function getStoryContextSettings(): Promise<StoryContextSettings> {
  return request<StoryContextSettings>("/dashboard/story-context");
}

export async function updateStoryContextSettings(
  body: StoryContextSettings
): Promise<void> {
  return request<void>("/dashboard/story-context", {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}
