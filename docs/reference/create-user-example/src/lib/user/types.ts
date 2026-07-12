// Domain models. No react, no next, no framework anywhere in lib/.
export interface User {
  id: string;
  email: string;
  name: string;
  passwordHash: string; // never the plaintext password
  createdAt: string;
}
