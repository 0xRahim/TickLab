import Image from "next/image";

/** Product logo mark: white rounded tile so the mark reads on both themes. */
export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center overflow-hidden rounded-md bg-white"
      style={{ width: size, height: size }}
    >
      <Image src="/logo.png" alt="TickLab logo" width={size} height={size} priority />
    </span>
  );
}
