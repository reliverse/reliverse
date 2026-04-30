import { siGithub } from "simple-icons";

import { BrandIcon, type BrandIconProps } from "./brand-icon";

export function GitHubIcon(props: BrandIconProps) {
  return <BrandIcon icon={siGithub} {...props} />;
}
