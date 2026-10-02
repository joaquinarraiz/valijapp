// WhatsApp numbers shown to clients (digits only, country code included).
export const FORGOT_PASSWORD_WA = "5492235984575"; // "¿Te olvidaste la contraseña?"
export const SUPPORT_WA = "5492234396065";         // "Consultas y pagos"

export function waTo(number, text) {
  return "https://wa.me/" + number + (text ? "?text=" + encodeURIComponent(text) : "");
}
