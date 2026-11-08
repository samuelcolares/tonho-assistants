import { useCallback, useMemo, useState } from "react";
import { AddItemDialog } from "./AddItemDialog";
import { AlertsView } from "./AlertsView";
import { uniqueCategories } from "./calc";
import { Dashboard, type AddPrefill } from "./Dashboard";
import { ItemDetail } from "./ItemDetail";
import { ItemsView } from "./ItemsView";
import { roomOptions } from "./rooms";
import { SettingsPage } from "./SettingsPage";
import { useComprasData } from "./useComprasData";

export type ComprasPage = "dashboard" | "items" | "alerts" | "settings";

/** Entry point of the Compras module: owns data, drill-in selection and shared dialogs. */
export function ComprasRoot({
  page,
  onGoItems,
  onGoSettings,
}: {
  page: ComprasPage;
  onGoItems?: () => void;
  onGoSettings?: () => void;
}) {
  const data = useComprasData();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [addCategory, setAddCategory] = useState<string | undefined>();
  const [addPrefill, setAddPrefill] = useState<AddPrefill | null>(null);

  const categories = useMemo(() => uniqueCategories(data.items ?? []), [data.items]);
  const rooms = useMemo(() => roomOptions(data.settingsRooms, data.items ?? []), [data.settingsRooms, data.items]);
  const closeDetail = useCallback(() => setSelectedId(null), []);
  const openAdd = (category?: string, prefill?: AddPrefill) => {
    setAddCategory(category);
    setAddPrefill(prefill && (prefill.name || prefill.url) ? prefill : null);
    setAddOpen(true);
  };

  return (
    <div className="-m-6 min-h-[calc(100%+3rem)] bg-cm-canvas p-6 font-cm font-light text-cm-body-strong">
      {selectedId ? (
        <ItemDetail
          key={selectedId}
          id={selectedId}
          templates={data.templates}
          categories={categories}
          rooms={rooms}
          onBack={closeDetail}
          onChanged={data.reload}
        />
      ) : page === "alerts" ? (
        <AlertsView data={data} onOpen={setSelectedId} onGoItems={onGoItems ?? (() => {})} />
      ) : page === "settings" ? (
        <SettingsPage data={data} />
      ) : page === "dashboard" ? (
        <Dashboard
          data={data}
          onOpen={setSelectedId}
          onAdd={(prefill) => openAdd(undefined, prefill)}
          onGoItems={onGoItems ?? (() => {})}
          onGoSettings={onGoSettings ?? (() => {})}
        />
      ) : (
        <ItemsView data={data} onOpen={setSelectedId} onAdd={openAdd} />
      )}

      <AddItemDialog
        open={addOpen}
        items={data.items ?? []}
        templates={data.templates}
        rooms={rooms}
        defaultCategory={addCategory}
        defaultTargetPct={data.settings?.defaultTargetPct}
        prefill={addPrefill}
        onClose={() => setAddOpen(false)}
        onCreated={(id) => {
          data.reload();
          setSelectedId(id);
        }}
      />
    </div>
  );
}
