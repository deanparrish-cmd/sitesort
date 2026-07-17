import { createContext, useContext, type ReactNode } from "react";
import { useProjectDetailState } from "./use-project-detail";

type State = ReturnType<typeof useProjectDetailState>;
export type ProjectDetailReady = Omit<State, "project"> & {
  project: NonNullable<State["project"]>;
};

const Ctx = createContext<ProjectDetailReady | null>(null);

export function ProjectDetailProvider({ value, children }: { value: ProjectDetailReady; children: ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useDetail(): ProjectDetailReady {
  const v = useContext(Ctx);
  if (!v) throw new Error("useDetail must be used within ProjectDetailProvider");
  return v;
}
