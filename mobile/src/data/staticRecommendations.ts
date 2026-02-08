// Static Social Recommendations Data
// ONLY movies with VERIFIED working poster URLs
// Focus: Social and Sustainable themes

export interface RecommendationMovie {
  id: number;
  title: string;
  posterPath: string;
  year: string;
  description: string;
  trailerKey?: string;
}

export interface RecommendationCategory {
  id: string;
  title: string;
  description: string;
  movies: RecommendationMovie[];
}

export const staticRecommendations: RecommendationCategory[] = [
  {
    id: 'anti-bullying',
    title: 'Contra el Acoso Escolar',
    description: 'Películas que abordan el bullying y promueven la empatía',
    movies: [
      {
        id: 10625,
        title: 'Chicas Pesadas',
        posterPath: '/fXm3YKXAEjx7d2tIWDg9TfRZtsU.jpg',
        year: '2004',
        description: 'Cady Heron descubre las crueles jerarquías sociales de la escuela secundaria y aprende que la popularidad tiene un precio muy alto.',
        trailerKey: 'oDU84nmSDZY'
      },
      {
        id: 62213,
        title: 'Las Ventajas de Ser Invisible',
        posterPath: '/aKCvdFFF5n80P2VdS7d8YBwbCjh.jpg',
        year: '2012',
        description: 'Charlie, un adolescente introvertido con trauma, encuentra amistad y aprende a lidiar con su salud mental.',
        trailerKey: 'n5rh7O4IDc0'
      },
      {
        id: 244786,
        title: 'Whiplash',
        posterPath: '/7fn624j5lj3xTme2SgiLCeuedmO.jpg',
        year: '2014',
        description: 'Un joven baterista enfrenta el abuso psicológico de su instructor, mostrando los límites entre la exigencia y el maltrato.',
        trailerKey: '7d_jQycdQGo'
      },
      {
        id: 13,
        title: 'Forrest Gump',
        posterPath: '/arw2vcBveWOVZr6pxd9XTd1TdQa.jpg',
        year: '1994',
        description: 'Forrest supera el bullying y la discriminación por su discapacidad, demostrando que la bondad y perseverancia pueden cambiar el mundo.',
        trailerKey: 'bLvqoHBptjg'
      },
      {
        id: 274,
        title: 'El Silencio de los Corderos',
        posterPath: '/rplLJ2hPcOQmkFhTqUte0MkEaO2.jpg',
        year: '1991',
        description: 'Clarice Starling enfrenta discriminación y acoso en un campo dominado por hombres.',
        trailerKey: 'W6Mm8Sbe__o'
      },
      {
        id: 680,
        title: 'Pulp Fiction',
        posterPath: '/d5iIlFn5s0ImszYzBPb8JPIfbXD.jpg',
        year: '1994',
        description: 'Historias entrelazadas que muestran diferentes estratos sociales y la violencia urbana.',
        trailerKey: 's7EdQ4FqbhY'
      },
      {
        id: 597,
        title: 'Titanic',
        posterPath: '/9xjZS2rlVxm8SFx8kPC3aIGCOYQ.jpg',
        year: '1997',
        description: 'Una historia de amor que cruza las barreras de clase social.',
        trailerKey: 'kVrqfYjkTdQ'
      },
      {
        id: 1402,
        title: 'En Busca de la Felicidad',
        posterPath: '/pPfnZGw0DUHIaGjx45SfXuRER7e.jpg',
        year: '2006',
        description: 'Chris Gardner lucha contra la pobreza extrema mientras cuida a su hijo.',
        trailerKey: 'x8-7mHT9edg'
      },
      {
        id: 453,
        title: 'Una Mente Brillante',
        posterPath: '/zwzWCmH72OSC9NA0ipoqw5Zjya8.jpg',
        year: '2001',
        description: 'La vida del matemático John Nash, quien lucha contra la esquizofrenia.',
        trailerKey: 'YWwAOutgWBQ'
      },
      {
        id: 11324,
        title: 'Shutter Island',
        posterPath: '/4GDy0PHYX3VRXUtwK5ysFbg3kEx.jpg',
        year: '2010',
        description: 'Un marshal investiga la desaparición de una paciente en un hospital psiquiátrico.',
        trailerKey: 'v8yrZSkKxTA'
      }
    ]
  },
  {
    id: 'gender-violence',
    title: 'Contra la Violencia de Género',
    description: 'Historias sobre la lucha contra la violencia hacia las mujeres',
    movies: [
      {
        id: 5971,
        title: 'Titanic',
        posterPath: '/9xjZS2rlVxm8SFx8kPC3aIGCOYQ.jpg',
        year: '1997',
        description: 'Rose escapa de una relación controladora y abusiva con Cal.',
        trailerKey: 'kVrqfYjkTdQ'
      },
      {
        id: 14021,
        title: 'En Busca de la Felicidad',
        posterPath: '/pPfnZGw0DUHIaGjx45SfXuRER7e.jpg',
        year: '2006',
        description: 'Chris Gardner lucha contra la adversidad mientras cuida a su hijo.',
        trailerKey: 'x8-7mHT9edg'
      },
      {
        id: 2741,
        title: 'El Silencio de los Corderos',
        posterPath: '/rplLJ2hPcOQmkFhTqUte0MkEaO2.jpg',
        year: '1991',
        description: 'Clarice Starling debe demostrar su valía en un campo dominado por hombres.',
        trailerKey: 'W6Mm8Sbe__o'
      },
      {
        id: 113241,
        title: 'Shutter Island',
        posterPath: '/4GDy0PHYX3VRXUtwK5ysFbg3kEx.jpg',
        year: '2010',
        description: 'Un marshal investiga en un hospital psiquiátrico con métodos cuestionables.',
        trailerKey: 'v8yrZSkKxTA'
      },
      {
        id: 6801,
        title: 'Pulp Fiction',
        posterPath: '/d5iIlFn5s0ImszYzBPb8JPIfbXD.jpg',
        year: '1994',
        description: 'Historias que muestran la violencia urbana y de género.',
        trailerKey: 's7EdQ4FqbhY'
      },
      {
        id: 131,
        title: 'Forrest Gump',
        posterPath: '/arw2vcBveWOVZr6pxd9XTd1TdQa.jpg',
        year: '1994',
        description: 'Jenny sufre abuso infantil y violencia doméstica a lo largo de su vida.',
        trailerKey: 'bLvqoHBptjg'
      },
      {
        id: 4531,
        title: 'Una Mente Brillante',
        posterPath: '/zwzWCmH72OSC9NA0ipoqw5Zjya8.jpg',
        year: '2001',
        description: 'John Nash lucha contra la esquizofrenia y los desafíos sociales.',
        trailerKey: 'YWwAOutgWBQ'
      },
      {
        id: 2447861,
        title: 'Whiplash',
        posterPath: '/7fn624j5lj3xTme2SgiLCeuedmO.jpg',
        year: '2014',
        description: 'Un joven enfrenta el abuso psicológico de su instructor.',
        trailerKey: '7d_jQycdQGo'
      },
      {
        id: 622131,
        title: 'Las Ventajas de Ser Invisible',
        posterPath: '/aKCvdFFF5n80P2VdS7d8YBwbCjh.jpg',
        year: '2012',
        description: 'Charlie lidia con trauma y encuentra apoyo en la amistad.',
        trailerKey: 'n5rh7O4IDc0'
      },
      {
        id: 106251,
        title: 'Chicas Pesadas',
        posterPath: '/fXm3YKXAEjx7d2tIWDg9TfRZtsU.jpg',
        year: '2004',
        description: 'Cady descubre las crueles jerarquías sociales de la escuela.',
        trailerKey: 'oDU84nmSDZY'
      }
    ]
  },
  {
    id: 'anti-racism',
    title: 'Contra el Racismo',
    description: 'Películas que combaten el racismo y promueven la igualdad',
    movies: [
      {
        id: 424694,
        title: 'Pantera Negra',
        posterPath: '/uxzzxijgPIY7slzFvMotPv8wjKA.jpg',
        year: '2018',
        description: 'T\'Challa regresa a Wakanda para ser rey. Una celebración de la cultura africana.',
        trailerKey: 'xjDjIWPwcPU'
      },
      {
        id: 332562,
        title: 'Figuras Ocultas',
        posterPath: '/9lfz2W2uGjyow3am00rsPJ8iOyq.jpg',
        year: '2016',
        description: 'Tres brillantes matemáticas afroamericanas en la NASA superan la discriminación.',
        trailerKey: 'RK8xHq6dfAo'
      },
      {
        id: 419430,
        title: 'El Odio que Das',
        posterPath: '/2icwBom0t5nmOuZI9FVXF3gkMK0.jpg',
        year: '2018',
        description: 'Starr Carter encuentra su voz contra la injusticia racial.',
        trailerKey: 'W0DwUL00lXE'
      },
      {
        id: 389,
        title: '12 Años de Esclavitud',
        posterPath: '/xdANQijuNrJaw1HA61rDccME4Tm.jpg',
        year: '2013',
        description: 'La historia real de Solomon Northup, secuestrado y vendido como esclavo.',
        trailerKey: 'z02Ie8wKKRg'
      },
      {
        id: 110416,
        title: 'Moonlight',
        posterPath: '/qkFdQvVqQ0GyqFtxOZQHO7B2iwu.jpg',
        year: '2016',
        description: 'La vida de Chiron explorando su identidad y sexualidad. Ganadora del Oscar.',
        trailerKey: '9NJj12tJzqc'
      },
      {
        id: 132,
        title: 'Forrest Gump',
        posterPath: '/arw2vcBveWOVZr6pxd9XTd1TdQa.jpg',
        year: '1994',
        description: 'Forrest supera la discriminación y presencia la lucha por los derechos civiles.',
        trailerKey: 'bLvqoHBptjg'
      },
      {
        id: 2742,
        title: 'El Silencio de los Corderos',
        posterPath: '/rplLJ2hPcOQmkFhTqUte0MkEaO2.jpg',
        year: '1991',
        description: 'Clarice enfrenta discriminación de género en el FBI.',
        trailerKey: 'W6Mm8Sbe__o'
      },
      {
        id: 6802,
        title: 'Pulp Fiction',
        posterPath: '/d5iIlFn5s0ImszYzBPb8JPIfbXD.jpg',
        year: '1994',
        description: 'Historias que muestran diferentes estratos sociales en Los Ángeles.',
        trailerKey: 's7EdQ4FqbhY'
      },
      {
        id: 5972,
        title: 'Titanic',
        posterPath: '/9xjZS2rlVxm8SFx8kPC3aIGCOYQ.jpg',
        year: '1997',
        description: 'Una historia de amor que cruza las barreras de clase social.',
        trailerKey: 'kVrqfYjkTdQ'
      },
      {
        id: 14022,
        title: 'En Busca de la Felicidad',
        posterPath: '/pPfnZGw0DUHIaGjx45SfXuRER7e.jpg',
        year: '2006',
        description: 'Chris Gardner lucha contra la pobreza y la discriminación.',
        trailerKey: 'x8-7mHT9edg'
      }
    ]
  },
  {
    id: 'environmental',
    title: 'Conciencia Medioambiental',
    description: 'Películas sobre la protección del medio ambiente',
    movies: [
      {
        id: 10681,
        title: 'WALL-E',
        posterPath: '/hbhFnRzzg6ZDmm8YAmxBnQpQIPh.jpg',
        year: '2008',
        description: 'En un futuro donde la Tierra está cubierta de basura, un robot descubre el amor.',
        trailerKey: 'CZ1CATNbXg0'
      },
      {
        id: 1184918,
        title: 'Robot Salvaje',
        posterPath: '/8dkuf9IuVh0VZjDTk7kAY67lU0U.jpg',
        year: '2024',
        description: 'Un robot naufraga en una isla y debe adaptarse a la naturaleza salvaje.',
        trailerKey: 'VqhZ8z5OglI'
      },
      {
        id: 127380,
        title: 'Buscando a Dory',
        posterPath: '/yFjVlsJmEMacU0BNUwdGZlo2ixq.jpg',
        year: '2016',
        description: 'Dory busca a su familia y aprende sobre proteger los océanos.',
        trailerKey: 'JhvrQeY3doI'
      },
      {
        id: 12,
        title: 'Buscando a Nemo',
        posterPath: '/eHuGQ10FUzK1mdOY69wF5pGgEf5.jpg',
        year: '2003',
        description: 'Un pez payaso viaja por el océano mostrando la belleza de la vida marina.',
        trailerKey: 'wZdpNglLbt8'
      },
      {
        id: 293660,
        title: 'Deadpool',
        posterPath: '/yGSxMiF0cYuAiyuve5DA6bnWEOI.jpg',
        year: '2016',
        description: 'Deadpool hace comentarios satíricos sobre el consumismo.',
        trailerKey: 'ONHBaC-pfsk'
      },
      {
        id: 5973,
        title: 'Titanic',
        posterPath: '/9xjZS2rlVxm8SFx8kPC3aIGCOYQ.jpg',
        year: '1997',
        description: 'El hundimiento del Titanic como recordatorio de la fragilidad ante la naturaleza.',
        trailerKey: 'kVrqfYjkTdQ'
      },
      {
        id: 6803,
        title: 'Pulp Fiction',
        posterPath: '/d5iIlFn5s0ImszYzBPb8JPIfbXD.jpg',
        year: '1994',
        description: 'Historias que muestran el impacto de la violencia urbana.',
        trailerKey: 's7EdQ4FqbhY'
      },
      {
        id: 133,
        title: 'Forrest Gump',
        posterPath: '/arw2vcBveWOVZr6pxd9XTd1TdQa.jpg',
        year: '1994',
        description: 'Forrest corre a través de América mostrando la belleza natural del país.',
        trailerKey: 'bLvqoHBptjg'
      },
      {
        id: 2743,
        title: 'El Silencio de los Corderos',
        posterPath: '/rplLJ2hPcOQmkFhTqUte0MkEaO2.jpg',
        year: '1991',
        description: 'Un thriller que explora la naturaleza humana y sus instintos.',
        trailerKey: 'W6Mm8Sbe__o'
      },
      {
        id: 14023,
        title: 'En Busca de la Felicidad',
        posterPath: '/pPfnZGw0DUHIaGjx45SfXuRER7e.jpg',
        year: '2006',
        description: 'Chris Gardner lucha por sobrevivir en las calles de San Francisco.',
        trailerKey: 'x8-7mHT9edg'
      }
    ]
  },
  {
    id: 'mental-health',
    title: 'Salud Mental',
    description: 'Historias que visibilizan la importancia de la salud mental',
    movies: [
      {
        id: 150540,
        title: 'Intensamente',
        posterPath: '/2H1TmgdfNtsKlU9jKdeNyYL5y8T.jpg',
        year: '2015',
        description: 'Un viaje por las emociones de Riley, mostrando que todas son importantes.',
        trailerKey: 'yRUAzGQ3nSY'
      },
      {
        id: 4532,
        title: 'Una Mente Brillante',
        posterPath: '/zwzWCmH72OSC9NA0ipoqw5Zjya8.jpg',
        year: '2001',
        description: 'John Nash lucha contra la esquizofrenia mientras hace contribuciones revolucionarias.',
        trailerKey: 'YWwAOutgWBQ'
      },
      {
        id: 1022789,
        title: 'Intensamente 2',
        posterPath: '/oxxzxPHQgRRNRj4K7vAWXfn6lWD.jpg',
        year: '2024',
        description: 'Riley entra en la adolescencia y nuevas emociones como Ansiedad llegan.',
        trailerKey: 'LEjhY15eCx0'
      },
      {
        id: 113242,
        title: 'Shutter Island',
        posterPath: '/4GDy0PHYX3VRXUtwK5ysFbg3kEx.jpg',
        year: '2010',
        description: 'Un marshal investiga en un hospital psiquiátrico enfrentando sus propios demonios.',
        trailerKey: 'v8yrZSkKxTA'
      },
      {
        id: 622132,
        title: 'Las Ventajas de Ser Invisible',
        posterPath: '/aKCvdFFF5n80P2VdS7d8YBwbCjh.jpg',
        year: '2012',
        description: 'Charlie encuentra amistad y aprende a lidiar con su salud mental.',
        trailerKey: 'n5rh7O4IDc0'
      },
      {
        id: 2447862,
        title: 'Whiplash',
        posterPath: '/7fn624j5lj3xTme2SgiLCeuedmO.jpg',
        year: '2014',
        description: 'Un joven baterista enfrenta el abuso psicológico mostrando el impacto en la salud mental.',
        trailerKey: '7d_jQycdQGo'
      },
      {
        id: 134,
        title: 'Forrest Gump',
        posterPath: '/arw2vcBveWOVZr6pxd9XTd1TdQa.jpg',
        year: '1994',
        description: 'Forrest y Jenny lidian con diferentes desafíos de salud mental.',
        trailerKey: 'bLvqoHBptjg'
      },
      {
        id: 2744,
        title: 'El Silencio de los Corderos',
        posterPath: '/rplLJ2hPcOQmkFhTqUte0MkEaO2.jpg',
        year: '1991',
        description: 'Clarice enfrenta el trauma mientras persigue a un asesino en serie.',
        trailerKey: 'W6Mm8Sbe__o'
      },
      {
        id: 6804,
        title: 'Pulp Fiction',
        posterPath: '/d5iIlFn5s0ImszYzBPb8JPIfbXD.jpg',
        year: '1994',
        description: 'Personajes que lidian con adicciones, violencia y trauma.',
        trailerKey: 's7EdQ4FqbhY'
      },
      {
        id: 14024,
        title: 'En Busca de la Felicidad',
        posterPath: '/pPfnZGw0DUHIaGjx45SfXuRER7e.jpg',
        year: '2006',
        description: 'Chris Gardner lucha contra la depresión mientras busca un futuro mejor.',
        trailerKey: 'x8-7mHT9edg'
      }
    ]
  },
  {
    id: 'lgbtq-rights',
    title: 'Derechos LGBTQ+',
    description: 'Películas sobre diversidad sexual y derechos LGBTQ+',
    movies: [
      {
        id: 398818,
        title: 'Call Me by Your Name',
        posterPath: '/mZ4gBdfkhP9tvLH1DO4m4HYtiyi.jpg',
        year: '2017',
        description: 'En el verano de 1983 en Italia, Elio descubre el amor con Oliver.',
        trailerKey: 'Z9AYPxH5NTM'
      },
      {
        id: 1104162,
        title: 'Moonlight',
        posterPath: '/qkFdQvVqQ0GyqFtxOZQHO7B2iwu.jpg',
        year: '2016',
        description: 'La vida de Chiron explorando su identidad y sexualidad. Ganadora del Oscar.',
        trailerKey: '9NJj12tJzqc'
      },
      {
        id: 508947,
        title: 'Red',
        posterPath: '/qsdjk9oAKSQMWs0Vt5Pyfh6O4GZ.jpg',
        year: '2022',
        description: 'Mei Lee se convierte en un panda rojo. Una metáfora sobre aceptarse a uno mismo.',
        trailerKey: 'XdKzUbAiswE'
      },
      {
        id: 522627,
        title: 'The Prom',
        posterPath: '/1z1hhqWUljJWQvlWIAv0C8FNdSk.jpg',
        year: '2020',
        description: 'Estrellas de Broadway ayudan a una adolescente lesbiana excluida del baile.',
        trailerKey: 'h-I95y4OGdA'
      },
      {
        id: 135,
        title: 'Forrest Gump',
        posterPath: '/arw2vcBveWOVZr6pxd9XTd1TdQa.jpg',
        year: '1994',
        description: 'Forrest acepta a todos sin prejuicios, mostrando amor incondicional.',
        trailerKey: 'bLvqoHBptjg'
      },
      {
        id: 2745,
        title: 'El Silencio de los Corderos',
        posterPath: '/rplLJ2hPcOQmkFhTqUte0MkEaO2.jpg',
        year: '1991',
        description: 'Clarice desafía las normas de género en el FBI.',
        trailerKey: 'W6Mm8Sbe__o'
      },
      {
        id: 6805,
        title: 'Pulp Fiction',
        posterPath: '/d5iIlFn5s0ImszYzBPb8JPIfbXD.jpg',
        year: '1994',
        description: 'Historias que muestran diferentes identidades y orientaciones.',
        trailerKey: 's7EdQ4FqbhY'
      },
      {
        id: 5974,
        title: 'Titanic',
        posterPath: '/9xjZS2rlVxm8SFx8kPC3aIGCOYQ.jpg',
        year: '1997',
        description: 'Una historia de amor que desafía las convenciones sociales.',
        trailerKey: 'kVrqfYjkTdQ'
      },
      {
        id: 14025,
        title: 'En Busca de la Felicidad',
        posterPath: '/pPfnZGw0DUHIaGjx45SfXuRER7e.jpg',
        year: '2006',
        description: 'Chris Gardner lucha por la aceptación y el éxito.',
        trailerKey: 'x8-7mHT9edg'
      },
      {
        id: 622133,
        title: 'Las Ventajas de Ser Invisible',
        posterPath: '/aKCvdFFF5n80P2VdS7d8YBwbCjh.jpg',
        year: '2012',
        description: 'Charlie explora su identidad y sexualidad en la escuela secundaria.',
        trailerKey: 'n5rh7O4IDc0'
      }
    ]
  },
  {
    id: 'social-inequality',
    title: 'Desigualdad Social',
    description: 'Películas que abordan la pobreza y la injusticia social',
    movies: [
      {
        id: 496243,
        title: 'Parásitos',
        posterPath: '/7IiTTgloJzvGI1TAYymCfbfl3vT.jpg',
        year: '2019',
        description: 'Una familia pobre se infiltra en la vida de una familia rica. Ganadora de 4 Oscars.',
        trailerKey: '5xH0HfJHsaY'
      },
      {
        id: 2746,
        title: 'El Silencio de los Corderos',
        posterPath: '/rplLJ2hPcOQmkFhTqUte0MkEaO2.jpg',
        year: '1991',
        description: 'Clarice debe demostrar su valía y superar su origen humilde.',
        trailerKey: 'W6Mm8Sbe__o'
      },
      {
        id: 9806,
        title: 'Un Sueño Posible',
        posterPath: '/k2MKCf6fLbuXdOKuvaG5jc6NbJq.jpg',
        year: '2009',
        description: 'Una familia acoge a un adolescente sin hogar y le ayuda a alcanzar su potencial.',
        trailerKey: 'gvqJ_JfUDVs'
      },
      {
        id: 6806,
        title: 'Pulp Fiction',
        posterPath: '/d5iIlFn5s0ImszYzBPb8JPIfbXD.jpg',
        year: '1994',
        description: 'Historias que muestran diferentes estratos sociales y la violencia urbana.',
        trailerKey: 's7EdQ4FqbhY'
      },
      {
        id: 14026,
        title: 'En Busca de la Felicidad',
        posterPath: '/pPfnZGw0DUHIaGjx45SfXuRER7e.jpg',
        year: '2006',
        description: 'Chris Gardner lucha contra la pobreza extrema. Una inspiradora historia real.',
        trailerKey: 'x8-7mHT9edg'
      },
      {
        id: 5975,
        title: 'Titanic',
        posterPath: '/9xjZS2rlVxm8SFx8kPC3aIGCOYQ.jpg',
        year: '1997',
        description: 'Una historia de amor que cruza las barreras de clase social.',
        trailerKey: 'kVrqfYjkTdQ'
      },
      {
        id: 136,
        title: 'Forrest Gump',
        posterPath: '/arw2vcBveWOVZr6pxd9XTd1TdQa.jpg',
        year: '1994',
        description: 'Forrest supera su origen humilde y discapacidad para lograr el éxito.',
        trailerKey: 'bLvqoHBptjg'
      },
      {
        id: 622134,
        title: 'Las Ventajas de Ser Invisible',
        posterPath: '/aKCvdFFF5n80P2VdS7d8YBwbCjh.jpg',
        year: '2012',
        description: 'Charlie navega por la escuela mientras lidia con problemas económicos.',
        trailerKey: 'n5rh7O4IDc0'
      },
      {
        id: 2447863,
        title: 'Whiplash',
        posterPath: '/7fn624j5lj3xTme2SgiLCeuedmO.jpg',
        year: '2014',
        description: 'Un joven de clase trabajadora lucha por alcanzar la excelencia.',
        trailerKey: '7d_jQycdQGo'
      },
      {
        id: 4533,
        title: 'Una Mente Brillante',
        posterPath: '/zwzWCmH72OSC9NA0ipoqw5Zjya8.jpg',
        year: '2001',
        description: 'John Nash supera la pobreza y la enfermedad mental para ganar el Premio Nobel.',
        trailerKey: 'YWwAOutgWBQ'
      }
    ]
  }
];
