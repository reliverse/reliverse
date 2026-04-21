import { Button } from "@repo/ui/button";

interface SocialLoginButtonProps {
  provider: string;
  icon: React.ReactNode;
  disabled?: boolean;
  callbackURL: string;
}

export function SignInSocialButton(props: SocialLoginButtonProps) {
  const providerLabel =
    props.provider === "github"
      ? "GitHub"
      : props.provider.charAt(0).toUpperCase() + props.provider.slice(1);

  return (
    <Button variant="outline" className="w-full" type="button" disabled={props.disabled}>
      {props.icon}
      {providerLabel} sign-in moved to Bleverse
    </Button>
  );
}
