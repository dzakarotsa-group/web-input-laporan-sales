export function whatsappChatUrl(phone) {
  const input = String(phone ?? "").trim();
  if (!input) return "";

  const waLink = input.match(/^(?:https?:\/\/)?(?:www\.)?wa\.me\/(\+?[\d\s().-]+)\/?$/i);
  const apiLink = input.match(/^(?:https?:\/\/)?(?:api\.)?whatsapp\.com\/send\?phone=(\+?[\d\s().-]+)(?:&[^#]*)?(?:#.*)?$/i);
  const numberInput = waLink?.[1] || apiLink?.[1] || input;
  if (!waLink && !apiLink && !/^\+?[\d\s().-]+$/.test(numberInput)) return "";

  let number = numberInput.replace(/\D/g, "");
  if (!number) return "";
  if (number.startsWith("00")) {
    number = number.slice(2);
  } else if (!numberInput.startsWith("+") && number.startsWith("0")) {
    number = `62${number.slice(1)}`;
  } else if (!numberInput.startsWith("+") && !number.startsWith("62")) {
    number = `62${number}`;
  }

  return number.length >= 8 && number.length <= 15
    ? `https://wa.me/${number}`
    : "";
}
