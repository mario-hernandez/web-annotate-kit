export interface ReviewUser {
  id: string;
  name: string;
  color: string;
  role: 'admin' | 'reviewer';
}

/** User definition accepted by <ReviewProvider>. `password` is erased before it hits React state. */
export interface ReviewUserDef extends ReviewUser {
  password: string;
}

export interface ReviewComment {
  id: string;
  author: string;
  authorColor: string;
  page: string;
  x: number;
  y: number;
  text: string;
  createdAt: string;
  updatedAt?: string | null;
  resolved?: boolean;
  section?: string | null;
  nearestText?: string | null;
  selector?: string | null;
  tagName?: string | null;
  screenshotUrl?: string | null;
}
