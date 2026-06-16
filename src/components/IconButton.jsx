export function IconButton({ icon: Icon, label, active = false, danger = false, disabled = false, onClick }) {
  return (
    <button
      className={`icon-button ${active ? "is-active" : ""} ${danger ? "is-danger" : ""}`}
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-label={label}
      title={label}
    >
      <Icon size={22} strokeWidth={2.2} />
    </button>
  );
}
