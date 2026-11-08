import { useCallback, useMemo, useState } from "react";
import { AddItemDialog } from "./AddItemDialog";
import { uniqueCategories } from "./calc";
import { Dashboard } from "./Dashboard";
import { ItemDetail } from "./ItemDetail";
import { ItemsView } from "./ItemsView";
import { SettingsDialog } from "./SettingsDialog";
import { useComprasData } from "./useComprasData";

export type ComprasPage = "dashboard" | "items" | "settings";

/** Entry point of the Compras module: owns data, drill-in selection and shared dialogs. */
export function ComprasRoot({ page }: { page: ComprasPage }) {
  const data = useComprasData();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [addCategory, setAddCategory] = useState<string | undefined>();
  // a entrada "Configurações" da barra lateral abre o painel com o diálogo já aberto
  const [settingsOpen, setSettingsOpen] = useState(page === "settings");

  const categories = useMemo(() => uniqueCategories(data.items ?? []), [data.items]);
  const closeDetail = useCallback(() => setSelectedId(null), []);
  const openAdd = (category?: string) => {
    setAddCategory(category);
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
          onBack={closeDetail}
          onChanged={data.reload}
        />
      ) : page === "dashboard" || page === "settings" ? (
        <Dashboard data={data} onOpen={setSelectedId} onAdd={() => openAdd()} onSettings={() => setSettingsOpen(true)} />
      ) : (
        <ItemsView data={data} onOpen={setSelectedId} onAdd={openAdd} onSettings={() => setSettingsOpen(true)} />
      )}

      <AddItemDialog
        open={addOpen}
        items={data.items ?? []}
        templates={data.templates}
        defaultCategory={addCategory}
        onClose={() => setAddOpen(false)}
        onCreated={(id) => {
          data.reload();
          setSelectedId(id);
        }}
      />
      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} onImported={data.reload} />
    </div>
  );
}
