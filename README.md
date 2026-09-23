# Tonho Assistants

App desktop (Tauri + React + TypeScript) organizado em torno de três cachorros:

- **Antonio Pepperoni** — organização de arquivos (pastas monitoradas, regras de mover/excluir)
- **Dante Margherita** — lembretes e agenda
- **Bonnie Calabresa** — vault de informações (senhas, notas)

## Desenvolvimento

```bash
npm install
npm run tauri dev
```

## Build de produção

```bash
npm run tauri build
```

Gera o instalador `.msi` e `.exe` (NSIS) em `src-tauri/target/release/bundle/`.

## Releases / auto-update

Uma tag `vX.Y.Z` empurrada para o repositório dispara o workflow `.github/workflows/release.yml`,
que builda os instaladores e publica uma release no GitHub com os artefatos assinados. O app
verifica atualizações nessa release automaticamente (tela Configurações → Atualizações).
