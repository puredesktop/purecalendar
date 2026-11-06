import { forwardRef } from 'react'
import { Button as PlatformButton, type ButtonProps } from '@purescience/platform-ui/components/common/buttons/Button'

const MARKS = {
  primary: { 'data-calendar-primary': '' },
  danger: { 'data-calendar-danger': '' },
  text: { 'data-calendar-flat': '' },
} as const

/**
 * The platform's Button, marked with what it is. On a themed desktop the platform paints a primary button in the text colour
 * and gives a stylesheet nothing to find a variant by; ui/styles.ts gives the marked ones their look.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(props, ref) {
  return <PlatformButton ref={ref} {...(MARKS as Record<string, object>)[props.variant ?? '']} {...props} />
})
