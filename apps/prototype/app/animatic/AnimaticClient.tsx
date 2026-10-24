"use client";

import { Player } from "@/components/animatic/Player";
import { flows } from "@/demo/storyboard";
import { scenes } from "./scenes";

export function AnimaticClient({ initialFlow }: { initialFlow?: string }) {
  return <Player flows={flows} scenes={scenes} initialFlow={initialFlow} />;
}
