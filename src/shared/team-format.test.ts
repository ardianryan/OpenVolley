import { describe, expect, it } from 'bun:test';
import { splitTeamRegionName } from './team-format';

describe('splitTeamRegionName (Smart Splice)', () => {
  it('moves KOTA / KAB region suffix onto second line', () => {
    expect(splitTeamRegionName('SMPN 1 Kota Mojokerto')).toEqual({
      primary: 'SMPN 1',
      region: 'KOTA MOJOKERTO',
    });
    expect(splitTeamRegionName('SMPN 2 Kab. Sidoarjo')).toEqual({
      primary: 'SMPN 2',
      region: 'KAB. SIDOARJO',
    });
  });

  it('moves trailing city/kabupaten name onto second line', () => {
    expect(splitTeamRegionName('SMPN 2 Candi Sidoarjo')).toEqual({
      primary: 'SMPN 2 CANDI',
      region: 'SIDOARJO',
    });
    expect(splitTeamRegionName('SMPN 1 Gedeg Mojokerto')).toEqual({
      primary: 'SMPN 1 GEDEG',
      region: 'MOJOKERTO',
    });
  });

  it('keeps short names intact with optional fallback school', () => {
    expect(splitTeamRegionName('SMPN 1 Trawas', 'Mojokerto')).toEqual({
      primary: 'SMPN 1 TRAWAS',
      region: 'MOJOKERTO',
    });
  });
});
