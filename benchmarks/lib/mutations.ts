/**
 * Mutation catalogs, as data rather than a script that ran once.
 *
 * A patch's tests are worth what they catch, and the only way to know what they
 * catch is to break the patch on purpose and watch them fail. That was a scratch
 * script for most of this work, which meant the evidence for "these tests are
 * load-bearing" evaporated as soon as the terminal scrolled. It lives here now so
 * that a test can be checked against the mutations it is supposed to kill, and so
 * that the failure a mutation produces can be read back out — that failing case
 * is the fixture worth keeping when the sweep around it goes away.
 */

export interface Mutation {
  /** what the mutated code does, not what the edit looks like */
  name: string;
  /** must appear exactly once in the patch file */
  find: string;
  replace: string;
  /**
   * Set only when the mutation is expected to survive, carrying the argument for
   * why it is unobservable rather than untested. A survivor without one of these
   * is a hole in the tests. A survivor with one is a claim, and the runner fails
   * if the claim stops holding — an equivalent mutant that starts being caught
   * means the reasoning was wrong.
   */
  survives?: string;
}

export interface MutationSet {
  /** filename under benchmarks/patches/ */
  patch: string;
  /** paths under benchmarks/, run in order until one fails */
  tests: string[];
  mutations: Mutation[];
}
