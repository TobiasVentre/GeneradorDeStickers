export class DomainError extends Error {
  constructor(message?: string) {
    super(message);
    // Fix para herencia correcta en TS/Node
    Object.setPrototypeOf(this, new.target.prototype);
    this.name = new.target.name;
  }
}

export class StickerDoesNotFitError extends DomainError {
  constructor(message = "El sticker no entra en el pliego con el gap/margen configurado.") {
    super(message);
  }
}

export class MixedStickerSizesError extends DomainError {
  constructor(message = "Los stickers no tienen el mismo tamaño en px (se requiere homogeneidad).") {
    super(message);
  }
}

export class InvalidSpecError extends DomainError {
  constructor(message = "Especificación inválida.") {
    super(message);
  }
}