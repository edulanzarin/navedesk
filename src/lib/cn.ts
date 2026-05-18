import clsx, { type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Mescla classes Tailwind resolvendo conflitos.
 *
 * Combina `clsx` (composição condicional de classes) com `tailwind-merge`
 * (resolução de conflitos entre utilitários Tailwind), garantindo que a
 * última utilidade conflitante vença.
 *
 * @example
 * cn("px-2 py-1", condition && "px-4") // => "py-1 px-4"
 */
export function cn(...inputs: ClassValue[]): string {
    return twMerge(clsx(inputs));
}
