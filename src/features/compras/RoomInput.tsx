import { useId } from "react";
import { CmInput } from "./ui";

interface RoomInputProps {
  value: string | null;
  options: string[];
  onChange: (room: string | null) => void;
  id?: string;
  placeholder?: string;
  autoFocus?: boolean;
}

/** Free-text room field with suggestions (native combobox: type anything or pick from the list). */
export function RoomInput({ value, options, onChange, id, placeholder = "Escolha ou digite", autoFocus }: RoomInputProps) {
  const listId = useId();
  return (
    <>
      <CmInput
        id={id}
        list={listId}
        value={value ?? ""}
        autoComplete="off"
        autoFocus={autoFocus}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)}
      />
      <datalist id={listId}>
        {options.map((r) => (
          <option key={r} value={r} />
        ))}
      </datalist>
    </>
  );
}
