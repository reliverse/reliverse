type Session = {
  user: {
    name: string;
    email: string;
  };
};

const authClient = {
  useSession(): { data: Session | null; isPending: boolean } {
    return { data: null, isPending: false };
  },
  signOut(_options?: { fetchOptions?: { onSuccess?: () => void } }) {},
};

export default authClient;
