export function cleanAiAnswer(text: string) {
  let result = text;
  for (let pass = 0; pass < 2; pass++) {
    result = result.replace(/&(?:#(x[0-9a-f]+|[0-9]+)|amp|nbsp|quot|apos|lt|gt);/gi, (entity, number: string | undefined) => {
      if (number) {
        const point = number[0].toLowerCase() === "x" ? parseInt(number.slice(1), 16) : Number(number);
        return Number.isInteger(point) && point >= 32 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff) ? String.fromCodePoint(point) : "";
      }
      return ({ "&amp;": "&", "&nbsp;": " ", "&quot;": '"', "&apos;": "'", "&lt;": "<", "&gt;": ">" } as Record<string, string>)[entity.toLowerCase()] ?? entity;
    });
  }
  return result.split("\n").filter(line => !/^\s*\[\^[^\]]+\]:/.test(line)).join("\n").replace(/\[\^[\w-]+\]/g, "").replace(/[ \t]+\n/g, "\n").trim();
}
