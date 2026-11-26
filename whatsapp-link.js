export function whatsappChatUrl(phone) {
  const input = String(phone ?? "").trim();
  if (!input || !/^\+?[\d\s().-]+$/.test(input)) return "";

  let number = input.replace(/\D/g, "");
  if (!number) return "";
  if (number.startsWith("00")) {
    number = number.slice(2);
  } else if (!input.startsWith("+") && number.startsWith("0")) {
    number = `62${number.slice(1)}`;
  } else if (!input.startsWith("+") && !number.startsWith("62")) {
    number = `62${number}`;
  }

  return number.length >= 8 && number.length <= 15
    ? `https://wa.me/${number}`
    : "";
}
