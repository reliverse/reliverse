import { useId, type SVGProps } from "react";
import type { SimpleIcon } from "simple-icons";

export type BrandIconColor = "brand" | "currentColor" | (string & {});

export type BrandIconProps = Omit<SVGProps<SVGSVGElement>, "children" | "color"> & {
  size?: number | string;
  title?: string;
  decorative?: boolean;
  color?: BrandIconColor;
};

type BrandIconBaseProps = BrandIconProps & {
  icon: SimpleIcon;
  defaultColor?: BrandIconColor;
};

function resolveBrandIconColor(icon: SimpleIcon, color: BrandIconColor) {
  if (color === "brand") {
    return `#${icon.hex}`;
  }

  return color;
}

export function BrandIcon({
  icon,
  size = 24,
  width,
  height,
  title,
  decorative,
  color,
  defaultColor = "currentColor",
  fill,
  focusable = "false",
  ...svgProps
}: BrandIconBaseProps) {
  const generatedTitleId = useId();
  const isDecorative = decorative ?? title === undefined;
  const titleId = `${generatedTitleId}-title`;
  const titleText = title ?? icon.title;
  const resolvedColor = resolveBrandIconColor(icon, color ?? defaultColor);

  const accessibilityProps = isDecorative
    ? { "aria-hidden": true as const }
    : {
        "aria-labelledby": titleId,
        role: "img" as const,
      };

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={width ?? size}
      height={height ?? size}
      fill={fill ?? resolvedColor}
      focusable={focusable}
      {...accessibilityProps}
      {...svgProps}
    >
      {isDecorative ? null : <title id={titleId}>{titleText}</title>}
      <path d={icon.path} />
    </svg>
  );
}
