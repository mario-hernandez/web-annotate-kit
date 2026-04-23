export interface ReviewRecord {
  id: string;
  author: string;
  authorColor: string | null;
  page: string;
  x: number;
  y: number;
  text: string;
  createdAt: string;
  updatedAt: string | null;
  resolved: boolean;
  section: string | null;
  nearestText: string | null;
  selector: string | null;
  tagName: string | null;
  screenshotUrl: string | null;
}

export interface ReviewStorage {
  list(): Promise<ReviewRecord[]>;
  insert(record: ReviewRecord): Promise<void>;
  updateText(id: string, text: string, updatedAt: string): Promise<void>;
  updateScreenshot(id: string, screenshotUrl: string): Promise<void>;
  toggleResolved(id: string): Promise<void>;
  delete(id: string): Promise<string | null>;
}
