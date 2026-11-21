export interface OrbitSource {
  sourceId: string;
  title: string;
  url: string;
  date: string | null;
  stale: boolean;
  text: string;
}

export interface OrbitAnswer {
  text: string;
  citations: Array<Omit<OrbitSource, "text"> & { quote: string }>;
  limitations: string[];
}

export interface OrbitTurn {
  id: string;
  question: string;
  status: "processing" | "completed" | "failed" | "cancelled";
  answer: OrbitAnswer | null;
  error: string | null;
}

export interface OrbitUsage {
  limit: number;
  used: number;
  remaining: number;
  month: string;
}
