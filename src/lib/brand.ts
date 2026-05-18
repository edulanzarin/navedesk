/**
 * Constantes de marca do produto.
 *
 * Centraliza nome, slogan, organização e o caminho do logo em um único
 * lugar. Qualquer superfície que mostre identidade ao usuário (sidebar,
 * login, `<title>`, favicon) lê daqui — assim, renomear o produto ou
 * trocar o logo é uma alteração pontual.
 *
 * O logo fica em `public/`, então a URL é uma referência relativa à
 * raiz do site servida pelo Next (`/` em produção e em dev). Para
 * usar um arquivo diferente, basta colocar o `.png` em `public/` e
 * apontar `LOGO_PATH` para o nome correspondente.
 */

/** Nome do produto exibido na UI. */
export const BRAND_NAME = "Navedesk";

/** Organização que opera o produto — exibida no rodapé da sidebar. */
export const BRAND_ORG = "Navecon";

/** Descrição curta usada em `<meta name="description">`. */
export const BRAND_DESCRIPTION = "Sistema de helpdesk interno da Navecon";

/**
 * Caminho do logo dentro de `public/`. Trocar o arquivo lá → reflete em
 * todas as superfícies (favicon, sidebar, etc.) sem mudança de código.
 *
 * Convenção: PNG quadrado, idealmente 256×256 ou 512×512, com fundo
 * transparente. O componente que renderiza aplica `rounded` se quiser
 * cantos arredondados.
 */
export const LOGO_PATH = "/navedesk.png";
