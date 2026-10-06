export const FORM_SCHEMA = {
  version: 2,
  fields: [
    {
      key: "arrivalTime",
      label: "Arrival time",
      type: "time",
      format: "HH:mm",
      nullable: true,
    },
    {
      key: "distanceKm",
      label: "Distance travelled",
      type: "number",
      min: 0,
      nullable: true,
    },
    {
      key: "generalRemarks",
      label: "General remarks",
      type: "text",
      nullable: true,
    },
    {
      key: "priority",
      label: "Priority",
      type: "single-select",
      options: ["low", "medium", "high"],
      nullable: true,
    },
    {
      key: "tags",
      label: "Tags",
      type: "multi-select",
      options: ["urgent", "warranty", "follow-up", "parts-needed"],
    },
  ],
  groups: [
    {
      key: "materials",
      label: "Materials used",
      columns: [
        { key: "material", label: "Material", type: "text", required: true },
        {
          key: "quantity",
          label: "Quantity",
          type: "number",
          min: 0,
          required: true,
        },
        {
          key: "unit",
          label: "Unit",
          type: "single-select",
          options: ["m", "pcs"],
          required: true,
        },
      ],
    },
  ],
} as const;
