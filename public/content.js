'use strict';
// Course content. Quiz answers live ONLY on the server and are never sent to the browser
// until a quiz has been submitted. Video IDs were checked against YouTube's oEmbed endpoint.
const PASS_MARK = 55;

const sections = [
  {
    id: 'why-fire-safety-matters',
    title: 'Why fire safety matters',
    summary: 'Why fires are so dangerous and who is responsible for preventing them.',
    videos: [{ id: 'cnn-yvszLXE', title: 'Fire safety training film (prevention, fire triangle, response)' }],
    body: [
      { h: 'Fire moves faster than people expect', p: [
        'A small fire can grow out of control in a matter of minutes. Heat, thick smoke and toxic gases fill a room quickly, and the temperature near the ceiling can become unsurvivable long before flames reach you.',
        'Smoke, not flames, is the biggest killer in a fire. Breathing smoke can leave you confused and unconscious within moments, which is why getting out early matters more than anything else.' ] },
      { h: 'Why it matters in a school or workplace', p: [
        'Buildings that are busy with staff, pupils, visitors and contractors have many people who rely on you to know what to do. Some may need extra help to leave, such as young children, people with mobility problems or visitors who do not know the building.' ] },
      { h: 'The law and your responsibilities', p: [
        'In England and Wales the Regulatory Reform (Fire Safety) Order 2005 requires a "responsible person" (usually the employer, owner or person in control of the premises) to carry out a fire risk assessment, put sensible precautions in place, and train staff. Scotland and Northern Ireland have equivalent legislation.' ],
        list: [
          'The responsible person manages the fire risk assessment and keeps it up to date.',
          'Fire wardens or marshals help to run evacuations and check areas are clear.',
          'Every member of staff must follow instructions, report hazards and take part in drills.' ] },
      { h: 'Key points', list: [
        'Fires grow in minutes, and smoke is the main danger.',
        'People always come before property: never risk your life to save belongings.',
        'Fire safety is everyone\'s responsibility, not just the fire warden\'s.',
        'Regular training and drills turn a plan on paper into a habit.' ] }
    ],
    quiz: [
      { q: 'What causes the most deaths in fires?', options: ['Direct burns from flames', 'Smoke and toxic gases', 'Building collapse', 'Panic and crowding'], answer: 1, explain: 'Smoke inhalation is the leading cause of fire deaths, which is why leaving quickly is vital.' },
      { q: 'Who must carry out the fire risk assessment under UK fire safety law?', options: ['The local fire brigade', 'Any visitor to the building', 'The responsible person for the premises', 'The insurance company'], answer: 2, explain: 'The responsible person (employer, owner or person in control) is legally required to do it.' },
      { q: 'How quickly can a small fire become life-threatening?', options: ['Within a few minutes', 'After several hours', 'Only after the fire brigade arrives', 'Fires never grow that quickly'], answer: 0, explain: 'Fires can grow dangerously in minutes, so act immediately.' },
      { q: 'Whose responsibility is fire safety in a building?', options: ['Only the fire warden', 'Only the head or manager', 'Everyone who uses the building', 'Only the caretaker'], answer: 2, explain: 'Everyone has a part to play: reporting hazards, following instructions and joining drills.' },
      { q: 'In a fire, what comes first?', options: ['Saving valuable equipment', 'Protecting people and getting them out', 'Collecting your personal belongings', 'Tidying up the area'], answer: 1, explain: 'Life safety always comes before property.' },
      { q: 'Why are regular fire drills important?', options: ['They are only a legal formality', 'They make people know the routes and react without panic', 'They test how fast the fire brigade is', 'They replace the need for risk assessments'], answer: 1, explain: 'Practice builds habits so people know what to do when it is real.' }
    ]
  },
  {
    id: 'identifying-fire-hazards',
    title: 'Identifying fire hazards',
    summary: 'The fire triangle, common ignition sources and the hazards to look for.',
    videos: [
      { id: 'wxbMvhcGMTc', title: 'The basic fire triangle' },
      { id: '_uukVH7IpMw', title: 'Understanding fire hazards in the workplace' }
    ],
    body: [
      { h: 'The fire triangle', p: [
        'Fire needs three things to start and keep burning: heat (an ignition source), fuel (something that can burn) and oxygen (normally from the air). Take away any one of them and the fire goes out.' ],
        list: [ 'Heat: sparks, naked flames, hot surfaces, faulty electrics.', 'Fuel: paper, card, wood, fabric, flammable liquids and gases, rubbish.', 'Oxygen: present in the air, and increased by some equipment such as oxygen cylinders.' ] },
      { h: 'Common sources of ignition', list: [
        'Faulty or overloaded electrical equipment, damaged leads and daisy-chained extension sockets.',
        'Heaters placed too close to furniture, curtains or paperwork.',
        'Cooking equipment left unattended, including kitchens and staff rooms.',
        'Smoking materials and vaping equipment.',
        'Hot work such as welding, cutting or soldering.',
        'Arson and deliberate fire setting.' ] },
      { h: 'Common sources of fuel', list: [
        'Stored paper, cardboard, packaging and general waste.',
        'Flammable liquids and gases such as cleaning products, aerosols, solvents and gas cylinders.',
        'Soft furnishings, displays, decorations and plastics.',
        'Lithium-ion batteries charging on or near combustible materials.' ] },
      { h: 'Hazards to report straight away', list: [
        'Blocked or locked fire exits and corridors with items stored in them.',
        'Fire doors wedged open or damaged.',
        'Missing or damaged extinguishers, smoke detectors or exit signs.',
        'Scorch marks, burning smells, hot plugs or crackling electrical equipment.' ] },
      { h: 'Classes of fire', p: [ 'Fires are grouped by what is burning, which decides the correct extinguisher.' ], list: [
        'Class A: ordinary solids such as wood, paper, textiles.',
        'Class B: flammable liquids such as petrol and solvents.',
        'Class C: flammable gases.',
        'Class D: combustible metals.',
        'Class F: cooking oils and fats.',
        'Electrical: not a class, but a fire involving live equipment that needs a safe, non-conductive extinguisher.' ] }
    ],
    quiz: [
      { q: 'Which three elements make up the fire triangle?', options: ['Smoke, heat, fuel', 'Heat, fuel, oxygen', 'Fuel, water, oxygen', 'Heat, gas, smoke'], answer: 1, explain: 'Heat, fuel and oxygen. Remove one and the fire cannot continue.' },
      { q: 'Which of these is an ignition source?', options: ['A stack of cardboard', 'A faulty electrical lead', 'An exit sign', 'A fire door'], answer: 1, explain: 'A damaged lead can spark and supply the heat. Cardboard is fuel.' },
      { q: 'You find a fire exit blocked by boxes. What should you do?', options: ['Leave it for the caretaker next week', 'Move it if safe to do so and report it straight away', 'Ignore it, it is not your job', 'Lock the door to keep the boxes safe'], answer: 1, explain: 'Blocked exits can cost lives. Clear them if safe and report the hazard.' },
      { q: 'Which class of fire involves cooking oils and fats?', options: ['Class A', 'Class B', 'Class D', 'Class F'], answer: 3, explain: 'Class F covers cooking oils and fats and needs a wet chemical extinguisher.' },
      { q: 'Which of these is a fuel source?', options: ['Oxygen in the air', 'A spark from a switch', 'Waste paper in a bin', 'A smoke detector'], answer: 2, explain: 'Paper is a fuel. Oxygen and sparks are the other two sides of the triangle.' },
      { q: 'Why are fire doors that are wedged open dangerous?', options: ['They let in too much light', 'They allow fire and smoke to spread', 'They trigger the alarm', 'They are harder to clean'], answer: 1, explain: 'Fire doors hold back fire and smoke for a limited time, but only when they are closed.' }
    ]
  },
  {
    id: 'preventing-a-fire',
    title: 'Preventing a fire',
    summary: 'Good housekeeping, electrical safety and safe storage to stop fires starting.',
    videos: [ { id: '00p5y091DG4', title: 'Prevention of fires: workplace fire safety training' } ],
    body: [
      { h: 'Control the fuel: good housekeeping', list: [
        'Keep escape routes, stairways and corridors clear at all times.',
        'Do not let rubbish, paper and packaging build up. Store waste outside, away from the building.',
        'Store flammable liquids and gas cylinders in approved, ventilated, locked cabinets or stores.',
        'Keep decorations and displays away from lights, heaters and ceilings, and follow your site rules.' ] },
      { h: 'Control the heat: electrical and equipment safety', list: [
        'Report damaged plugs, cables and equipment. Do not use them until they are checked.',
        'Avoid overloading sockets or plugging extension leads into each other.',
        'Make sure portable electrical equipment is tested (PAT testing) as your site requires.',
        'Switch off and unplug equipment at the end of the day if procedures say so.',
        'Charge laptops, tools and e-bikes or scooters only with the proper charger, on a hard surface, and never overnight in escape routes.' ] },
      { h: 'Smoking, cooking and hot work', list: [
        'Smoke and vape only in permitted outdoor areas and put materials out fully in a proper bin.',
        'Never leave cooking unattended.',
        'Hot work needs a permit, a fire watch during the work and a check afterwards.' ] },
      { h: 'Keep your fire protection working', list: [
        'Never prop open fire doors or cover smoke detectors.',
        'Do not obstruct extinguishers, alarm call points or exit signs.',
        'Take part in alarm tests and report faults.' ] },
      { h: 'Security matters too', p: [ 'Arson is a leading cause of fires in some buildings. Keep doors secure, report suspicious behaviour, and keep bins and flammable materials away from the building.' ] }
    ],
    quiz: [
      { q: 'Where should waste and rubbish be stored?', options: ['Next to the building under a window', 'In the escape corridor', 'Outside, away from the building, in a secure bin or store', 'Behind a fire door'], answer: 2, explain: 'Waste outside and away from the building reduces fuel and arson risk.' },
      { q: 'What should you do if you notice a damaged electrical lead?', options: ['Wrap it in tape and keep using it', 'Stop using it and report it', 'Move it to another room', 'Wait to see if it fails'], answer: 1, explain: 'Damaged equipment must be taken out of use and reported.' },
      { q: 'Which is the safest way to use extension leads?', options: ['Plug several extensions into each other', 'Use one lead and do not overload it', 'Cover it with a rug', 'Run it through a door gap'], answer: 1, explain: 'Daisy-chaining and overloading are common causes of electrical fires.' },
      { q: 'Why is it unsafe to prop open a fire door?', options: ['It might get damaged', 'It cannot hold back fire and smoke when open', 'It makes the room cold', 'It stops the alarm'], answer: 1, explain: 'A fire door only works when it is closed.' },
      { q: 'What do hot work (welding, cutting) activities require?', options: ['Nothing special', 'A permit, a fire watch and a check afterwards', 'Only a smoke detector', 'Only a first-aid kit'], answer: 1, explain: 'Hot work is high risk and needs controls before, during and after the job.' },
      { q: 'Where should flammable liquids and gas cylinders be stored?', options: ['In the staff room', 'Under the stairs', 'In approved, ventilated, locked storage', 'Next to the boiler'], answer: 2, explain: 'Approved storage keeps fuel away from ignition sources and unauthorised people.' }
    ]
  },
  {
    id: 'responding-to-a-fire',
    title: 'Responding to a fire',
    summary: 'What to do if you discover a fire or hear the alarm.',
    videos: [
      { id: 'ReL-DM9xhpI', title: 'Fire emergency and fire prevention at your workplace' },
      { id: 'FGY7V2siVwQ', title: 'Emergency evacuation: everything you need to know' }
    ],
    body: [
      { h: 'If you discover a fire', p: [ 'Follow your site\'s procedure. In most workplaces and schools the steps are:' ], list: [
        '1. Raise the alarm: shout a warning and operate the nearest manual call point.',
        '2. Call the fire service on 999 (or 112) if it is not done automatically. Give the address, what is burning and whether anyone is trapped.',
        '3. Only if the fire is small, you are trained, you have a clear escape route behind you and you feel safe, you may try to tackle it with the right extinguisher.',
        '4. Otherwise leave immediately, close doors behind you as you go, and go to the assembly point.' ] },
      { h: 'When the alarm sounds', list: [
        'Stop what you are doing and leave by the nearest safe exit. Do not stop to collect belongings.',
        'Do not use lifts.',
        'Help anyone who needs assistance if it is safe, and follow their personal evacuation plan (PEEP) where there is one.',
        'Walk quickly, do not run, and do not go back for any reason.',
        'Close doors behind you to slow the spread of fire and smoke.' ] },
      { h: 'If there is smoke', list: [
        'Stay low where the air is clearer.',
        'Feel closed doors with the back of your hand. If hot, do not open them.',
        'If you are trapped, close the door, seal gaps with cloth, go to a window and signal for help, and call 999.' ] },
      { h: 'At the assembly point', list: [
        'Report to your fire warden or the person taking the register.',
        'Tell them if anyone is missing or if you saw anything unusual.',
        'Do not re-enter the building until the fire service or responsible person says it is safe.' ] },
      { h: 'Fight or flee?', p: [ 'Your safety comes first. If in any doubt, get out, stay out and let the fire and rescue service deal with it. Extinguishers are only for small fires, and only when your exit stays behind you.' ] }
    ],
    quiz: [
      { q: 'You discover a fire. What is the first thing you should do?', options: ['Try to put it out regardless of size', 'Raise the alarm', 'Collect your belongings', 'Open all the windows'], answer: 1, explain: 'Raise the alarm so everyone can start to leave, then call the fire service.' },
      { q: 'When the fire alarm sounds you should:', options: ['Finish your task first', 'Use the lift to leave quickly', 'Leave by the nearest safe exit without collecting belongings', 'Wait to see if it is a drill'], answer: 2, explain: 'Treat every alarm as real and leave straight away.' },
      { q: 'Why should you close doors behind you when you leave?', options: ['To keep the room tidy', 'To slow the spread of fire and smoke', 'To lock people out', 'To set off the alarm'], answer: 1, explain: 'Closed doors slow fire and smoke and give more time for others to escape.' },
      { q: 'A closed door feels hot to the back of your hand. What should you do?', options: ['Open it quickly', 'Keep it closed and find another way out', 'Kick it open', 'Wait beside it'], answer: 1, explain: 'A hot door suggests fire on the other side. Use another route or signal for help.' },
      { q: 'When is it appropriate to use an extinguisher?', options: ['On any fire', 'Only on small fires, if trained and with a clear escape route', 'When the fire is blocking your exit', 'Only after the fire brigade arrives'], answer: 1, explain: 'Only if it is small, you are trained and you have an exit behind you.' },
      { q: 'What should you do at the assembly point?', options: ['Go back inside to check', 'Report to your fire warden for the roll call', 'Go home', 'Wait in your car'], answer: 1, explain: 'The roll call tells the responders whether anyone is still inside.' }
    ]
  },
  {
    id: 'fire-extinguishers',
    title: 'Using fire extinguishers',
    summary: 'The five main extinguisher types, colour codes and the PASS technique.',
    videos: [
      { id: 'GVBamXXVD30', title: 'How to use a fire extinguisher' },
      { id: 'PQV71INDaqY', title: 'Using a fire extinguisher: the PASS method' },
      { id: '9j2b6Gm5J7A', title: 'The main fire extinguisher types and their uses' },
      { id: 'zYnfxbwqmfY', title: 'Every type of fire extinguisher explained' }
    ],
    body: [
      { h: 'Types of extinguisher (UK colour bands)', p: [ 'Extinguishers are red with a coloured band or label showing what they contain. Always read the label before use.' ], list: [
        'Water (red band): ordinary solids such as paper, wood and fabric. Never on electrical or oil fires.',
        'Foam (cream band): solids and flammable liquids. Check the label before using near electrics.',
        'Dry powder (blue band): wide range including liquids and gases, but powder can cause breathing and visibility problems indoors.',
        'CO2 (black band): electrical fires and flammable liquids. No residue, but it is very cold and the horn gets cold, so do not hold it by the horn.',
        'Wet chemical (yellow band): cooking oil and fat fires (Class F) and also suitable for solids.' ] },
      { h: 'Before you use one', list: [
        'Raise the alarm and make sure the fire service is called.',
        'Make sure the fire is small (no bigger than a waste bin) and not spreading.',
        'Keep your escape route behind you and stay close to the exit.',
        'Choose the right extinguisher for the fire. The wrong one can make it worse.' ] },
      { h: 'The PASS technique', list: [
        'P: Pull the pin, which breaks the tamper seal.',
        'A: Aim the nozzle or hose at the base of the fire, not at the flames.',
        'S: Squeeze the lever to release the contents.',
        'S: Sweep from side to side across the base of the fire until it is out.' ], p: [ 'Stand well back and move closer only if the fire is dying down. With CO2, aim the horn at the base of the fire and be careful not to touch the horn.' ] },
      { h: 'After use', list: [
        'Watch the area in case the fire re-ignites.',
        'If the fire does not go out quickly or the extinguisher runs out, leave straight away.',
        'Tell your responsible person so the extinguisher can be replaced or recharged.' ] },
      { h: 'Never', list: [
        'Never use water on a cooking oil or electrical fire.',
        'Never turn your back on a fire or let it come between you and the exit.',
        'Never try to tackle a large or fast-spreading fire.' ] }
    ],
    quiz: [
      { q: 'What does PASS stand for?', options: ['Push, Aim, Spray, Stop', 'Pull, Aim, Squeeze, Sweep', 'Point, Activate, Spray, Sweep', 'Pull, Activate, Squeeze, Stop'], answer: 1, explain: 'Pull the pin, Aim at the base, Squeeze the lever and Sweep side to side.' },
      { q: 'Where should you aim the extinguisher?', options: ['At the top of the flames', 'At the smoke', 'At the base of the fire', 'At the ceiling'], answer: 2, explain: 'The base of the fire is where the fuel is burning.' },
      { q: 'Which extinguisher is suitable for an electrical fire?', options: ['Water', 'CO2', 'Wet chemical on a live socket', 'Any extinguisher'], answer: 1, explain: 'CO2 does not conduct electricity and leaves no residue. Water on live equipment is dangerous.' },
      { q: 'What colour band marks a wet chemical extinguisher?', options: ['Blue', 'Black', 'Yellow', 'Cream'], answer: 2, explain: 'Yellow is wet chemical, used for cooking oil and fat fires.' },
      { q: 'Which statement is true before you use an extinguisher?', options: ['You should block the exit so the fire cannot spread', 'The alarm should be raised and your escape route should be behind you', 'You should never raise the alarm', 'You should stand as close as possible'], answer: 1, explain: 'Raise the alarm first and always keep your escape route behind you.' },
      { q: 'A cooking-oil pan catches fire. What must you never use?', options: ['A fire blanket by a trained person', 'A wet chemical extinguisher', 'Water', 'Turning off the heat if safe'], answer: 2, explain: 'Water on burning oil causes a violent flare-up.' }
    ]
  },
  {
    id: 'fire-drills-and-evacuation',
    title: 'Fire drills and evacuation',
    summary: 'How drills work, your role in them and how to help others leave safely.',
    videos: [
      { id: '97O0swHQfSU', title: 'Why fire drills matter: workplace emergency evacuation' },
      { id: 'MFmEYVtaqGY', title: 'How to conduct a fire drill' }
    ],
    body: [
      { h: 'Why we hold fire drills', p: [ 'Drills let everyone practise the evacuation, find problems in the plan, and build confidence. They are usually held at least once or twice a year (and more often in higher-risk or high-turnover settings). Your own plan and risk assessment decide the frequency.' ] },
      { h: 'Before a drill', list: [
        'Know your two nearest exits from every area you work in.',
        'Know where the assembly point is and how to get there.',
        'Know who your fire wardens are and how to contact them.',
        'Check personal emergency evacuation plans (PEEPs) for anyone who needs help to leave.' ] },
      { h: 'During a drill: treat it as real', list: [
        'When the alarm sounds, stop what you are doing and leave.',
        'Take visitors and anyone nearby with you.',
        'Check toilets, store rooms and quiet areas on the way out if it is safe and that is your role.',
        'Close doors, do not use lifts, and walk calmly to the assembly point.' ] },
      { h: 'Roles in an evacuation', list: [
        'Fire warden or marshal: sweeps the area, checks it is clear and reports to the person in charge.',
        'Teacher or team leader: takes the register or head count and reports any missing people.',
        'Person in charge: makes the decisions, liaises with the fire service and decides when to re-enter.' ] },
      { h: 'After the drill', list: [
        'Take part in the debrief.',
        'Report anything that slowed you down, such as blocked routes, an alarm you could not hear or confusion about the plan.',
        'The responsible person records the drill and acts on the findings.' ] },
      { h: 'Helping people who need assistance', p: [ 'Never leave a disabled person alone unless it is the plan and they are in a safe refuge. Use the PEEP, tell the fire service where they are, and do not use lifts unless a specific evacuation lift procedure exists.' ] }
    ],
    quiz: [
      { q: 'What is the main purpose of a fire drill?', options: ['To test the fire brigade', 'To practise the evacuation and find problems in the plan', 'To waste time', 'To check the lifts work'], answer: 1, explain: 'Drills build habits and reveal weaknesses before a real emergency.' },
      { q: 'When the alarm sounds during a drill you should:', options: ['Ignore it because it is only a drill', 'Treat it as real and leave', 'Finish your lesson or meeting first', 'Use the lift'], answer: 1, explain: 'Treating drills as real is what makes them useful.' },
      { q: 'What does PEEP stand for?', options: ['Personal Emergency Evacuation Plan', 'Public Emergency Exit Policy', 'Protected Escape Exit Path', 'Primary Evacuation Entry Point'], answer: 0, explain: 'A PEEP sets out how a person who needs help will leave safely.' },
      { q: 'What should the person taking the register do at the assembly point?', options: ['Go home', 'Check everyone is present and report any missing people', 'Re-enter to look for them', 'Leave the group'], answer: 1, explain: 'Report missing people to the person in charge, never go back in yourself.' },
      { q: 'Who decides when it is safe to re-enter the building?', options: ['Whoever is nearest the door', 'The fire service or responsible person', 'The first person to arrive', 'Any member of staff'], answer: 1, explain: 'Nobody re-enters until the fire service or responsible person says so.' },
      { q: 'Why should you report problems you noticed during a drill?', options: ['To get others in trouble', 'So that the plan can be improved', 'It is not necessary', 'To avoid the next drill'], answer: 1, explain: 'Feedback is how drills improve the plan.' }
    ]
  }
];

module.exports = { PASS_MARK, sections };
