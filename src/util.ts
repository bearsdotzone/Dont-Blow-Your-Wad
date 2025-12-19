import { getRelated, Item, mallPrice, print, Slot, toItem, toSlot, visitUrl } from "kolmafia";
import { $item } from "libram";

export function getCurrentCrimboWad(html: string): WadType | null {
  const knownCrimboWads = ["hot", "cold", "spooky", "stench", "sleaze"];
  const imgRegex = /<img[^>]+>/gi;
  let match: RegExpExecArray | null;

  while ((match = imgRegex.exec(html)) !== null) {
    const imgTag = match[0];

    // Extract alt or title
    const altMatch = /alt=['"]([^'"]+)['"]/i.exec(imgTag);
    const titleMatch = /title=['"]([^'"]+)['"]/i.exec(imgTag);

    const name = (altMatch?.[1] || titleMatch?.[1] || "").toLowerCase().trim();
    const wadType = name.replace(/\s+wad$/, "") as WadType;

    // Only return if it is a known Crimbo wad (ignore Twinkly)
    if (knownCrimboWads.includes(wadType)) {
      return wadType;
    }
  }

  return null;
}

export const WAD_TYPES = ["hot", "cold", "spooky", "stench", "sleaze"] as const;
export type WadType = (typeof WAD_TYPES)[number];

function wadValueFromPulverize(
  p: Record<string, number> | null,
  wadPrice: number,
  wadType: WadType
): number {
  if (!p) return 0;

  return (
    ((p[`${wadType} wad`] ?? 0) * wadPrice) / 1_000_000 +
    ((p[`${wadType} nuggets`] ?? 0) * wadPrice) / 5 / 1_000_000 +
    ((p[`${wadType} powder`] ?? 0) * wadPrice) / 25 / 1_000_000
  );
}

interface PricegunSale {
  date: string;
  unitPrice: number;
  quantity: number;
}

interface PricegunHistory {
  itemId: number;
  date: string;
  volume: number;
  price: string;
}

interface PricegunItem {
  itemId: number;
  name: string;
  image: string;
  value: number;
  volume: number;
  date: string;
  sales: PricegunSale[];
  history: PricegunHistory[];
}

function fetchPricegunItem(item: Item): PricegunItem | null {
  try {
    const text = visitUrl(`https://pricegun.loathers.net/api/${item.id}`);
    return JSON.parse(text) as PricegunItem;
  } catch {
    return null;
  }
}

function pricegunValue(item: Item): number | null {
  const data = fetchPricegunItem(item);
  if (!data || !data.value || data.value <= 0) return null;
  return data.value;
}

const pricegunCache = new Map<Item, number | null>();

function pricegunPrice(item: Item): number | null {
  if (!pricegunCache.has(item)) {
    pricegunCache.set(item, pricegunValue(item));
  }
  return pricegunCache.get(item)!;
}

export function results(wadTypes: WadType[]) {
  const twinklyMall = mallPrice($item`twinkly wad`);
  const twinklyPricegun = pricegunPrice($item`twinkly wad`) ?? twinklyMall;

  const mallWadPrices = new Map<WadType, number>(
    wadTypes.map((w) => [w, mallPrice(toItem(`${w} wad`))])
  );

  const pricegunWadPrices = new Map<WadType, number>(
    wadTypes.map((w) => {
      const item = toItem(`${w} wad`);
      return [w, pricegunPrice(item) ?? mallPrice(item)];
    })
  );

  const wadResults = Item.all()
    .filter((i) => toSlot(i) !== Slot.none)
    .map((item) => {
      const p = getRelated(item, "pulverize");
      if (!p) return null;

      let mallValue = 0;
      let pricegunValue = 0;

      for (const wadType of wadTypes) {
        mallValue += wadValueFromPulverize(p, mallWadPrices.get(wadType) ?? 0, wadType);

        pricegunValue += wadValueFromPulverize(p, pricegunWadPrices.get(wadType) ?? 0, wadType);
      }

      // Twinkly always included
      mallValue +=
        ((p["twinkly wad"] ?? 0) * twinklyMall) / 1_000_000 +
        ((p["twinkly nuggets"] ?? 0) * twinklyMall) / 5 / 1_000_000 +
        ((p["twinkly powder"] ?? 0) * twinklyMall) / 25 / 1_000_000;

      pricegunValue +=
        ((p["twinkly wad"] ?? 0) * twinklyPricegun) / 1_000_000 +
        ((p["twinkly nuggets"] ?? 0) * twinklyPricegun) / 5 / 1_000_000 +
        ((p["twinkly powder"] ?? 0) * twinklyPricegun) / 25 / 1_000_000;

      const price = mallPrice(item);
      if (price <= 0) return null;

      const mallNet = mallValue - price;
      const pgNet = pricegunValue - price;

      if (mallNet <= 0 && pgNet <= 0) return null;

      return {
        price,
        item,
        mallNet,
        mallROI: mallNet / price,
        pgNet,
        pgROI: pgNet / price,
      };
    })
    .filter((o): o is NonNullable<typeof o> => o !== null)
    .sort((a, b) => b.pgNet - a.pgNet); // sort by Pricegun by default

  for (const { price, item, mallNet, mallROI, pgNet, pgROI } of wadResults) {
    print(`For Item: ${item}: price: ${price}`);
    print(`  mall:     net ${mallNet.toFixed(0)} meat (ROI ${(mallROI * 100).toFixed(1)}%)`);
    print(`  pricegun: net ${pgNet.toFixed(0)} meat (ROI ${(pgROI * 100).toFixed(1)}%)`);
    print(``);
  }

  let out = "";
  for (const { price, item } of wadResults) {
    out += `mallbuy 1000 ${item}@${price};`;
  }
  print(out);

  out = "";
  for (const { item } of wadResults) {
    out += `pulverize * ${item};`;
  }
  print(out);
}
