export type ManualFoundationFormValues = {
  brand: string;
  shade_name: string;
  shade_code: string;
  product_name: string;
  L_value: number;
  a_value: number;
  b_value: number;
  hex_color: string;
  undertone: string;
};

export type PhotoMetaValues = {
  brand: string;
  product_name: string;
  shade_name: string;
  shade_code: string;
};

export type ActiveAdminPanel =
  | "none"
  | "manual-create"
  | "manual-edit"
  | "photo"
  | "roi";

export function createDefaultManualForm(): ManualFoundationFormValues {
  return {
    brand: "",
    shade_name: "",
    shade_code: "",
    product_name: "",
    L_value: 0,
    a_value: 0,
    b_value: 0,
    hex_color: "#000000",
    undertone: "",
  };
}

export function createDefaultPhotoMeta(): PhotoMetaValues {
  return {
    brand: "",
    product_name: "",
    shade_name: "",
    shade_code: "",
  };
}
