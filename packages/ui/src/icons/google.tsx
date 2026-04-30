import { siGoogle } from "simple-icons";

import { BrandIcon, type BrandIconProps } from "./brand-icon";

export function GoogleIcon(props: BrandIconProps) {
  return <BrandIcon icon={siGoogle} defaultColor="brand" {...props} />;
}
