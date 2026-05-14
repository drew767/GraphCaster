// Copyright GraphCaster. All Rights Reserved.

import { Text } from "../../ui/Text/Text";

export interface FormErrorProps {
  message: string;
  fieldName?: string;
}

export function FormError({ message, fieldName }: FormErrorProps) {
  return (
    <Text
      as="span"
      size="xs"
      color="danger"
      className="gc-form-error"
      {...(fieldName ? { } : {})}
    >
      <span data-testid={fieldName ? `form-error-${fieldName}` : "form-error"}>
        {message}
      </span>
    </Text>
  );
}
