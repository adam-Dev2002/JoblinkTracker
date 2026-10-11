/// <reference types="astro/client" />

declare namespace App {
  interface Locals {
    joblinkSession?: import('../shared/lib/client-session').Session
  }
}
